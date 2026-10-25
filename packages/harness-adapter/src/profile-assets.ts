/**
 * Profile patch assets for the app-owned Harness home (D12, D01 §5.2/§8.3).
 *
 * Two per-home patch files are always applied at launch via `--patch`:
 *
 * 1. telemetry: the OTLP session telemetry is forced to DISABLED — the only
 *    legal off switch (D01 §5.2), keeping the runtime free of feedback-mode
 *    uploads.
 * 2. bridge mount: inserts the approval bridge plugin row so the profile
 *    answers upstream `approval/request` through the Host's D08 gate.
 *
 * The bridge package itself must be installed into the profile workspace as a
 * `file:` dependency (upstream plugin-manager recognizes file:/link: specs)
 * before the mount patch can resolve; installBridgeIntoProfile runs that
 * pnpm add against the profile directory.
 */
import { execFile } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Telemetry DISABLED overlay (D01 §5.2 verified patch shape). */
export const TELEMETRY_DISABLED_PATCH = [
  "- id: session-telemetry-otel",
  "  config:",
  "    mode: DISABLED",
  "",
].join("\n");

/** Bridge mount row matching @deepseek-bot/harness-bridge's bundle patch. */
export const BRIDGE_MOUNT_PATCH = [
  "- insert:",
  "    - id: dsb-approval-bridge",
  '      name: "@deepseek-bot/harness-bridge"',
  "",
].join("\n");

export interface ProfilePatchPaths {
  readonly telemetryPatchPath: string;
  readonly bridgePatchPath: string;
}

/** Write both patch files under `<dshHome>/dsb-patches/` and return their paths. */
export function writeProfilePatches(dshHome: string): ProfilePatchPaths {
  const patchesDir = join(dshHome, "dsb-patches");
  mkdirSync(patchesDir, { recursive: true });
  const telemetryPatchPath = join(patchesDir, "telemetry-disabled.patch.yml");
  const bridgePatchPath = join(patchesDir, "bridge-mount.patch.yml");
  writeFileSync(telemetryPatchPath, TELEMETRY_DISABLED_PATCH, "utf8");
  writeFileSync(bridgePatchPath, BRIDGE_MOUNT_PATCH, "utf8");
  return { telemetryPatchPath, bridgePatchPath };
}

/** Injectable command runner (tests stub it; production shells out to pnpm). */
export type CommandRunner = (
  command: string,
  args: readonly string[],
  options: { readonly cwd: string },
) => Promise<void>;

function defaultCommandRunner(
  command: string,
  args: readonly string[],
  options: { readonly cwd: string },
): Promise<void> {
  return execFileAsync(command, [...args], { cwd: options.cwd }).then(() => undefined);
}

export interface BridgeInstallOptions {
  /** The profile workspace directory (e.g. `<dshHome>/profiles/sdk`). */
  readonly profileDir: string;
  /** Absolute path of the built @deepseek-bot/harness-bridge package directory. */
  readonly bridgePackageDir: string;
  /** Command runner override for tests. */
  readonly runner?: CommandRunner;
}

/**
 * Install the bridge plugin into the profile workspace as a file: dependency.
 * The profile directory must exist (first profile boot materializes it).
 */
export async function installBridgeIntoProfile(options: BridgeInstallOptions): Promise<void> {
  const runner = options.runner ?? defaultCommandRunner;
  const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  await runner(command, ["add", `file:${options.bridgePackageDir}`, "--prefer-offline"], {
    cwd: options.profileDir,
  });
}
