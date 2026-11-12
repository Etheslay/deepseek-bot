import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EngineError } from "@deepseek-bot/runtime";
import { exportOfficeSlice } from "./artifacts.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function workspace(): string {
  const root = mkdtempSync(join(tmpdir(), "dsb-office-"));
  roots.push(root);
  return root;
}

describe("exportOfficeSlice", () => {
  it("returns one base64 slice of a pptx and the whole file size", () => {
    const root = workspace();
    writeFileSync(join(root, "lesson.pptx"), Buffer.from("PK-hello-pptx"));
    const first = exportOfficeSlice(root, "lesson.pptx", 0, 4);
    expect(Buffer.from(first.data, "base64").toString()).toBe("PK-h");
    expect(first.size).toBe(13);
    expect(first.mediaType).toBe("application/octet-stream");
    const rest = exportOfficeSlice(root, "lesson.pptx", 4, 20);
    expect(Buffer.from(rest.data, "base64").toString()).toBe("ello-pptx");
  });

  it("refuses other extensions, a missing file, and a path that leaves the workspace", () => {
    const root = workspace();
    writeFileSync(join(root, "notes.txt"), Buffer.from("hi"));
    expect(() => exportOfficeSlice(root, "notes.txt", 0, 4)).toThrow(EngineError);
    expect(() => exportOfficeSlice(root, "missing.pptx", 0, 4)).toThrow(EngineError);
    expect(() => exportOfficeSlice(root, "../escape.pptx", 0, 4)).toThrow(EngineError);
  });

  it("does not follow a symlink out of the workspace", () => {
    const root = workspace();
    const outside = workspace();
    writeFileSync(join(outside, "secret.pptx"), Buffer.from("secret"));
    symlinkSync(join(outside, "secret.pptx"), join(root, "linked.pptx"));
    expect(() => exportOfficeSlice(root, "linked.pptx", 0, 4)).toThrow(EngineError);
  });
});
