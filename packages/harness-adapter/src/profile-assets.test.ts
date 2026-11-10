import { existsSync, lstatSync, mkdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  BRIDGE_MOUNT_PATCH,
  TELEMETRY_DISABLED_PATCH,
  installBridgeIntoProfile,
  prepareAppToolProfile,
  writeProfilePatches,
} from "./profile-assets.js";

const roots: string[] = [];
afterAll(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("offline application tool profile preparation", () => {
  it("prepares a dependency-free bridge before the first profile launch and keeps repeated calls unchanged", () => {
    const root = makeRoot();
    const bridge = join(root, "source");
    mkdirSync(join(bridge, "dist"), { recursive: true });
    writeFileSync(join(bridge, "package.json"), JSON.stringify({ name: "@deepseek-bot/harness-bridge", type: "module", main: "./dist/index.js" }));
    writeFileSync(join(bridge, "dist", "index.js"), "export const name = 'test-bridge';\n");
    const home = join(root, "home");
    prepareAppToolProfile({ dshHome: home, bridgePackageDir: bridge });
    const installed = join(home, "profiles", "sdk", "node_modules", "@deepseek-bot", "harness-bridge");
    expect(readFileSync(join(installed, "dist", "index.js"), "utf8")).toContain("test-bridge");
    expect(JSON.parse(readFileSync(join(installed, "package.json"), "utf8"))).toMatchObject({ name: "@deepseek-bot/harness-bridge", main: "./dist/index.js" });
    const timestamp = statSync(join(installed, "dist", "index.js")).mtimeMs;
    prepareAppToolProfile({ dshHome: home, bridgePackageDir: bridge });
    expect(statSync(join(installed, "dist", "index.js")).mtimeMs).toBe(timestamp);
    writeFileSync(join(bridge, "dist", "index.js"), "export const name = 'updated-bridge';\n");
    prepareAppToolProfile({ dshHome: home, bridgePackageDir: bridge });
    expect(readFileSync(join(installed, "dist", "index.js"), "utf8")).toContain("updated-bridge");
  });

  it("fails clearly for unbuilt bridges and rejects profile paths outside the Harness home", () => {
    expect(() => prepareAppToolProfile({ dshHome: makeRoot(), bridgePackageDir: makeRoot() })).toThrow(/bridge build is unavailable/);
    expect(() => prepareAppToolProfile({ dshHome: makeRoot(), bridgePackageDir: makeRoot(), profile: "../outside" })).toThrow(/invalid profile/);
  });

  it.each(["package", "dist", "modules"] as const)("refuses a legacy %s junction without changing its outside target or removing the link", (location) => {
    const root = makeRoot();
    const source = join(root, "source");
    mkdirSync(join(source, "dist"), { recursive: true });
    writeFileSync(join(source, "package.json"), JSON.stringify({ name: "@deepseek-bot/harness-bridge", main: "./dist/index.js" }));
    writeFileSync(join(source, "dist", "index.js"), "export const name = 'replacement';");
    const home = join(root, "home");
    const target = join(home, "profiles", "sdk", "node_modules", "@deepseek-bot", "harness-bridge");
    const outside = join(root, "outside");
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(outside, "package.json"), '{"sentinel":"unchanged"}');
    writeFileSync(join(outside, "index.js"), "outside code");
    const link = location === "package" ? target : location === "dist" ? join(target, "dist") : join(home, "profiles", "sdk", "node_modules");
    mkdirSync(join(link, ".."), { recursive: true });
    symlinkSync(outside, link, process.platform === "win32" ? "junction" : "dir");
    expect(() => prepareAppToolProfile({ dshHome: home, bridgePackageDir: source })).toThrow(/symbolic link|junction/);
    expect(readFileSync(join(outside, "package.json"), "utf8")).toBe('{"sentinel":"unchanged"}');
    expect(readFileSync(join(outside, "index.js"), "utf8")).toBe("outside code");
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
  });

  it("rejects a linked source dist directory before creating the app-owned destination", () => {
    const root = makeRoot();
    const source = join(root, "source");
    const outside = join(root, "outside-dist");
    mkdirSync(source, { recursive: true });
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(source, "package.json"), JSON.stringify({ name: "@deepseek-bot/harness-bridge", main: "./dist/index.js" }));
    writeFileSync(join(outside, "index.js"), "outside source code");
    symlinkSync(outside, join(source, "dist"), process.platform === "win32" ? "junction" : "dir");
    const home = join(root, "home");
    expect(() => prepareAppToolProfile({ dshHome: home, bridgePackageDir: source })).toThrow(/symbolic link|junction/);
    expect(existsSync(home)).toBe(false);
    expect(readFileSync(join(outside, "index.js"), "utf8")).toBe("outside source code");
  });
});

function makeRoot(): string {
  const root = join(tmpdir(), `dsb-profiles-${Math.random().toString(36).slice(2)}`);
  roots.push(root);
  return root;
}

describe("writeProfilePatches", () => {
  it("writes the telemetry and bridge patches into the harness home", () => {
    const root = makeRoot();
    const paths = writeProfilePatches(root);
    expect(readFileSync(paths.telemetryPatchPath, "utf8")).toBe(TELEMETRY_DISABLED_PATCH);
    expect(readFileSync(paths.bridgePatchPath, "utf8")).toBe(BRIDGE_MOUNT_PATCH);
    expect(TELEMETRY_DISABLED_PATCH).toContain("mode: DISABLED");
    expect(BRIDGE_MOUNT_PATCH).toContain('"@deepseek-bot/harness-bridge"');
    expect(existsSync(join(root, "dsb-patches"))).toBe(true);
  });
});

describe("installBridgeIntoProfile", () => {
  it("runs pnpm add with the file: spec inside the profile directory", async () => {
    const calls: Array<{ command: string; args: readonly string[]; cwd: string }> = [];
    await installBridgeIntoProfile({
      profileDir: "D:\\home\\profiles\\sdk",
      bridgePackageDir: "D:\\app\\harness-bridge",
      runner: async (command, args, options) => {
        calls.push({ command, args, cwd: options.cwd });
      },
    });
    expect(calls).toEqual([
      {
        command: process.platform === "win32" ? "pnpm.cmd" : "pnpm",
        args: ["add", "file:D:\\app\\harness-bridge", "--prefer-offline"],
        cwd: "D:\\home\\profiles\\sdk",
      },
    ]);
  });

  it("keeps the mount patch in sync with the bridge package manifest", () => {
    // The patch row's name must match the package the Host installs into the
    // profile workspace; the manifest must expose the built dist entry.
    const bridgeManifest = JSON.parse(
      readFileSync(join(process.cwd(), "..", "harness-bridge", "package.json"), "utf8"),
    ) as { name?: string; main?: string; dsh?: { bundle?: { patch?: string } } };
    expect(bridgeManifest.name).toBe("@deepseek-bot/harness-bridge");
    expect(bridgeManifest.main).toBe("./dist/index.js");
    expect(bridgeManifest.dsh?.bundle?.patch).toBe("./cordis.patch.yml");
    expect(readFileSync(join(process.cwd(), "..", "harness-bridge", "cordis.patch.yml"), "utf8")).toContain(
      `"@deepseek-bot/harness-bridge"`,
    );
  });
});
