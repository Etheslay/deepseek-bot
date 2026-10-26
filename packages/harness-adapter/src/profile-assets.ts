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
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
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

export interface AppToolProfileOptions {
  readonly dshHome: string;
  readonly bridgePackageDir: string;
  readonly profile?: string;
}

/**
 * Stage the application's dependency-free bridge into the SDK profile before
 * its first launch. The pinned loader resolves this profile node_modules as
 * its second package anchor. No package manager, registry or network is used.
 * The app owns this one package; unrelated profile files are left intact.
 */
export function prepareAppToolProfile(options: AppToolProfileOptions): void {
  const profile = options.profile ?? "sdk";
  if (profile === "" || profile === "." || profile === ".." || profile === "node_modules" || /[/\\]/.test(profile)) {
    throw new Error("invalid profile name for application tool bridge");
  }
  const source = options.bridgePackageDir;
  const refuseLink = (file: string): void => {
    let linked: boolean;
    try {
      linked = lstatSync(file).isSymbolicLink();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    if (linked) {
      throw new Error("application tool bridge refuses a symbolic link or junction; rebuild the bridge or use an unlinked application profile");
    }
  };
  refuseLink(join(source, "package.json"));
  refuseLink(join(source, "dist"));
  let manifest: { name?: string; main?: string; dependencies?: Record<string, unknown> };
  try {
    manifest = JSON.parse(readFileSync(join(source, "package.json"), "utf8")) as typeof manifest;
    if (manifest.name !== "@deepseek-bot/harness-bridge" || manifest.main !== "./dist/index.js" ||
        Object.keys(manifest.dependencies ?? {}).length !== 0 || !existsSync(join(source, "dist", "index.js"))) {
      throw new Error("invalid bridge package");
    }
  } catch {
    throw new Error("application tool bridge build is unavailable; build the Host and bridge before chatting");
  }
  // The chosen Harness home may itself be a user-managed junction. Below
  // that root, every installation component must be app-owned real paths:
  // legacy pnpm file: installs can otherwise redirect these writes into the
  // original source checkout or an unrelated profile package.
  let target = options.dshHome;
  for (const part of ["profiles", profile, "node_modules", "@deepseek-bot", "harness-bridge"]) {
    target = join(target, part);
    refuseLink(target);
  }
  const files: Array<{ file: string; bytes: Buffer }> = [];
  const collectDirectory = (from: string, to: string) => {
    refuseLink(from);
    refuseLink(to);
    for (const entry of readdirSync(from, { withFileTypes: true })) {
      refuseLink(join(from, entry.name));
      refuseLink(join(to, entry.name));
      if (entry.isDirectory()) collectDirectory(join(from, entry.name), join(to, entry.name));
      else if (entry.isFile()) files.push({ file: join(to, entry.name), bytes: readFileSync(join(from, entry.name)) });
      else throw new Error("application tool bridge build contains unsupported file entries");
    }
  };
  // Preflight the complete source and destination before the first write.
  refuseLink(join(target, "package.json"));
  files.push({ file: join(target, "package.json"), bytes: readFileSync(join(source, "package.json")) });
  collectDirectory(join(source, "dist"), join(target, "dist"));
  const writeChanged = (file: string, bytes: Buffer) => {
    refuseLink(file);
    if (existsSync(file) && readFileSync(file).equals(bytes)) return;
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, bytes);
  };
  for (const { file, bytes } of files) writeChanged(file, bytes);
}
