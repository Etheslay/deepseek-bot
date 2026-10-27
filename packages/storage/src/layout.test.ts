import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  DATA_ROOT_ENV_VAR,
  describeDataLocations,
  ensureDataLayout,
  resolveDataRoot,
} from "./layout.js";
import { resolveHarnessHome, harnessLaunchEnv, HARNESS_HOME_ENV_VAR } from "./harness-home.js";
import { makeTempRoot, openTestDatabase } from "./test-support.js";
import { StorageError } from "./errors.js";

describe("resolveDataRoot", () => {
  it("prefers the explicit option", () => {
    expect(resolveDataRoot({ appDataDir: "D:\\tmp\\custom" })).toBe(
      path.resolve("D:\\tmp\\custom"),
    );
  });

  it("falls back to the environment override", () => {
    const previous = process.env[DATA_ROOT_ENV_VAR];
    process.env[DATA_ROOT_ENV_VAR] = "D:\\tmp\\from-env";
    try {
      expect(resolveDataRoot()).toBe(path.resolve("D:\\tmp\\from-env"));
    } finally {
      if (previous === undefined) {
        delete process.env[DATA_ROOT_ENV_VAR];
      } else {
        process.env[DATA_ROOT_ENV_VAR] = previous;
      }
    }
  });

  it("appends the product directory on Windows APPDATA", () => {
    const previous = process.env[DATA_ROOT_ENV_VAR];
    delete process.env[DATA_ROOT_ENV_VAR];
    try {
      const appData = process.env["APPDATA"] ?? "C:\\Users\\x\\AppData\\Roaming";
      expect(resolveDataRoot()).toBe(path.resolve(appData, "DeepSeekBot"));
    } finally {
      if (previous !== undefined) {
        process.env[DATA_ROOT_ENV_VAR] = previous;
      }
    }
  });

  it("refuses a filesystem root as the data root", () => {
    expect(() => resolveDataRoot({ appDataDir: "C:\\" })).toThrow(StorageError);
  });
});

describe("ensureDataLayout", () => {
  it("creates the documented directory layout", () => {
    const root = makeTempRoot();
    const layout = ensureDataLayout(root);
    expect(layout.dbFile).toBe(path.join(root, "app.sqlite"));
    expect(fs.statSync(layout.harnessHome).isDirectory()).toBe(true);
    expect(fs.statSync(layout.artifacts).isDirectory()).toBe(true);
    expect(fs.statSync(layout.backups).isDirectory()).toBe(true);
    expect(fs.statSync(layout.logs).isDirectory()).toBe(true);
    expect(fs.statSync(layout.cache).isDirectory()).toBe(true);
    expect(fs.statSync(layout.credentials).isDirectory()).toBe(true);
    expect(fs.statSync(layout.screenOutputs).isDirectory()).toBe(true);
  });

  it("is idempotent and never deletes content", () => {
    const root = makeTempRoot();
    const first = ensureDataLayout(root);
    fs.writeFileSync(path.join(first.artifacts, "keep.txt"), "x");
    const second = ensureDataLayout(root);
    expect(fs.readFileSync(path.join(second.artifacts, "keep.txt"), "utf8")).toBe("x");
  });

  it("refuses a root that is a file", () => {
    const root = makeTempRoot();
    const file = path.join(root, "not-a-dir");
    fs.writeFileSync(file, "x");
    expect(() => ensureDataLayout(file)).toThrow(StorageError);
  });
});

describe("describeDataLocations", () => {
  it("reports existing locations with sizes", () => {
    const layout = ensureDataLayout(makeTempRoot());
    fs.writeFileSync(path.join(layout.cache, "blob.bin"), "12345");
    const report = describeDataLocations(layout);
    const byName = new Map(report.locations.map((location) => [location.name, location]));
    expect(byName.get("database")?.exists).toBe(false);
    const cache = byName.get("cache");
    expect(cache?.exists).toBe(true);
    expect(cache?.bytes).toBe(5);
  });
});

describe("harness home", () => {
  it("resolves inside the data root and builds the launch env", () => {
    const layout = ensureDataLayout(makeTempRoot());
    const home = resolveHarnessHome(layout);
    expect(home).toBe(path.join(layout.root, "harness"));
    const env = harnessLaunchEnv(layout);
    expect(env[HARNESS_HOME_ENV_VAR]).toBe(home);
  });

  it("merges extra environment variables", () => {
    const layout = ensureDataLayout(makeTempRoot());
    const env = harnessLaunchEnv(layout, { DEEPSEEK_BOT_EXTRA: "1" });
    expect(env["DEEPSEEK_BOT_EXTRA"]).toBe("1");
    expect(Object.keys(env).length).toBe(2);
  });

  it("keeps the harness home isolated from any user CLI home", () => {
    const layout = ensureDataLayout(makeTempRoot());
    const db = openTestDatabase(layout);
    expect(layout.harnessHome).not.toContain(".deepseek");
    expect(layout.harnessHome.startsWith(layout.root)).toBe(true);
    db.close();
  });
});

describe("harness home containment", () => {
  it("refuses a layout whose harness home escaped the data root", () => {
    const layout = ensureDataLayout(makeTempRoot());
    const tampered = { ...layout, harnessHome: String.raw`D:\elsewhere\harness` };
    expect(() => resolveHarnessHome(tampered)).toThrow(/escaped/);
  });
});

describe("describeDataLocations with a live database", () => {
  it("reports the database file size when it exists", () => {
    const layout = ensureDataLayout(makeTempRoot());
    const db = openTestDatabase(layout);
    const report = describeDataLocations(layout);
    const database = report.locations.find((location) => location.name === "database");
    expect(database?.exists).toBe(true);
    expect(database?.bytes).toBeGreaterThan(0);
    db.close();
  });
});
