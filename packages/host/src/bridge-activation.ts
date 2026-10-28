/**
 * G2 approval-bridge activation: stage the app-owned bridge package into the
 * pinned profile at Host startup.
 *
 * The bridge-mount patch (writeProfilePatches) inserts the plugin row for
 * every dsh launch, but before this module existed the package itself was
 * only staged by the chat-time prepareProfile callback — so the FIRST dsh
 * spawn (a workflow run, a relay hop, or a chat before that callback ran)
 * started a profile whose node_modules lacked @deepseek-bot/harness-bridge,
 * and upstream printed `warning: 1 entry did not activate` with the approval
 * bridge inactive for that attempt.
 *
 * Staging here uses prepareAppToolProfile: idempotent (only changed files are
 * rewritten), junction-safe, and free of package managers, registries and the
 * network. It is best-effort: an unbuilt bridge package must not stop the
 * Host — chat turns still surface the same condition as RUNTIME_UNAVAILABLE
 * through their own prepareProfile check. Every outcome is appended to
 * `<logs>/bridge-install.jsonl` so a startup can be audited afterwards.
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { prepareAppToolProfile } from "@deepseek-bot/harness-adapter";

export type BridgeStageOutcome =
  | { readonly result: "installed"; readonly logFile: string; readonly stagedDir: string }
  | { readonly result: "unavailable"; readonly logFile: string; readonly detail: string };

export interface BridgeStageOptions {
  readonly harnessHome: string;
  readonly bridgePackageDir: string;
  readonly logsDir: string;
  /** The pinned profile the executor launches; keep in sync with DshSdkExecutor's default ("sdk"). */
  readonly profile?: string;
  readonly now?: () => Date;
}

export function stageApprovalBridge(options: BridgeStageOptions): BridgeStageOutcome {
  const profile = options.profile ?? "sdk";
  const stagedDir = join(
    options.harnessHome,
    "profiles",
    profile,
    "node_modules",
    "@deepseek-bot",
    "harness-bridge",
  );
  const logFile = join(options.logsDir, "bridge-install.jsonl");
  const at = (options.now ?? (() => new Date()))().toISOString();
  try {
    prepareAppToolProfile({
      dshHome: options.harnessHome,
      bridgePackageDir: options.bridgePackageDir,
      profile,
    });
    appendRecord(logFile, { at, result: "installed", profile });
    return { result: "installed", logFile, stagedDir };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    appendRecord(logFile, { at, result: "unavailable", profile, detail });
    return { result: "unavailable", logFile, detail };
  }
}

function appendRecord(file: string, record: Record<string, unknown>): void {
  try {
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, `${JSON.stringify(record)}\n`, "utf8");
  } catch {
    // A startup log write must never break Host assembly.
  }
}
