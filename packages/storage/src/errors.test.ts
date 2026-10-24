import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import {
  dataVersionUnsupported,
  diskFull,
  runtimeUnavailable,
  constraintError,
  invalidInput,
  openDatabase,
  parseJsonColumn,
  runInTransaction,
  storageErrorFromFsError,
  StorageError,
} from "./index.js";
import { ensureDataLayout } from "./layout.js";

function makeTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "dsb-edge-"));
}

describe("parseJsonColumn", () => {
  const schema = z.object({ value: z.string() });

  it("parses valid JSON into the schema type", () => {
    expect(parseJsonColumn(schema, '{"value":"ok"}', "unit")).toEqual({ value: "ok" });
  });

  it("rejects non-JSON content", () => {
    expect(() => parseJsonColumn(schema, "{not json", "unit")).toThrow(/not valid JSON/);
  });

  it("rejects content that fails the schema", () => {
    try {
      parseJsonColumn(schema, '{"value":42}', "unit");
      expect.fail("expected schema rejection");
    } catch (error) {
      expect((error as StorageError).code).toBe("INVALID_INPUT");
      expect(JSON.stringify((error as StorageError).details.issues)).toContain("path");
    }
  });
});

describe("runInTransaction", () => {
  it("commits and returns the callback result", () => {
    const layout = ensureDataLayout(makeTmp());
    const db = openDatabase(layout.dbFile);
    const value = runInTransaction(db.raw, () => 42);
    expect(value).toBe(42);
    db.close();
  });
});

describe("constraintError", () => {
  it("maps foreign key failures to INVALID_INPUT", () => {
    expect(() =>
      constraintError(new Error("FOREIGN KEY constraint failed"), "do it"),
    ).toThrow(/referenced entity/);
  });

  it("maps unique failures to INVALID_INPUT", () => {
    expect(() =>
      constraintError(new Error("UNIQUE constraint failed: bots.id"), "do it"),
    ).toThrow(/duplicate/);
  });

  it("rethrows unrelated errors untouched", () => {
    const original = new Error("some other failure");
    expect(() => constraintError(original, "do it")).toThrow(original);
  });
});

describe("storageErrorFromFsError", () => {
  it("passes StorageError through unchanged", () => {
    const original = invalidInput("original");
    expect(storageErrorFromFsError(original, "unit")).toBe(original);
  });

  it("maps ENOSPC to DISK_FULL", () => {
    const error = storageErrorFromFsError(
      Object.assign(new Error("no space"), { code: "ENOSPC" }),
      "writing",
    );
    expect(error.code).toBe("DISK_FULL");
    expect(error.retryable).toBe(true);
  });

  it("maps unknown errors to RUNTIME_UNAVAILABLE with the errno code", () => {
    const error = storageErrorFromFsError(
      Object.assign(new Error("boom"), { code: "EPERM" }),
      "renaming",
    );
    expect(error.code).toBe("RUNTIME_UNAVAILABLE");
    expect(error.details["errnoCode"]).toBe("EPERM");
  });

  it("handles non-Error inputs", () => {
    const error = storageErrorFromFsError("just a string", "parsing");
    expect(error.details["errnoCode"]).toBe("UNKNOWN");
  });
});

describe("error helper detail branches", () => {
  it("carries details when provided on every helper", () => {
    expect(dataVersionUnsupported("m", { a: 1 }).details).toEqual({ a: 1 });
    expect(diskFull("m", { b: 2 }).details).toEqual({ b: 2 });
    expect(runtimeUnavailable("m", { c: 3 }).details).toEqual({ c: 3 });
    expect(dataVersionUnsupported("m").details).toEqual({});
  });
});
