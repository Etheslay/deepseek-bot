import { existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  BRIDGE_MOUNT_PATCH,
  TELEMETRY_DISABLED_PATCH,
  installBridgeIntoProfile,
  writeProfilePatches,
} from "./profile-assets.js";

const roots: string[] = [];
afterAll(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
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
        command: "pnpm.cmd",
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
