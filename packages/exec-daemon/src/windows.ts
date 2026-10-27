import { stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  cancelled,
  invalidInput,
  timedOut,
  unavailable,
  type ScreenBackendError,
} from "./errors.js";
import {
  MAX_EDGE,
  MAX_TITLE_CHARS,
  MAX_WINDOWS,
  assertPid,
  assertUint64Decimal,
} from "./limits.js";
import { ProcessRunError, runFixedProcess } from "./process.js";

export const POWERSHELL_EXE = "powershell.exe";

export interface WindowIdentity {
  hwnd: string;
  pid: number;
  processStartTime: string;
}

export interface ListedWindow extends WindowIdentity {
  title: string;
  minimized: boolean;
  width: number;
  height: number;
  protected: boolean;
}

export type HelperRequest =
  | { op: "list" }
  | { op: "capture"; hwnd: string; pid: number; processStartTime: string; outputDirectory: string };

export interface HelperLaunch {
  command: typeof POWERSHELL_EXE;
  args: readonly string[];
  shell: false;
  windowsHide: true;
}

export interface HelperRunner {
  run(request: HelperRequest, signal: AbortSignal, timeoutMs: number): Promise<string>;
}

const HELPER_REASONS: Record<string, string> = {
  CLOSED: "target-closed",
  REUSED: "handle-reused",
  MINIMIZED: "minimized",
  PROTECTED: "protected",
  SIZE: "size",
  INPUT: "input",
  UNCONFIRMED: "unconfirmed",
};

export function windowsHelperScriptPath(): string {
  return fileURLToPath(new URL("../assets/win32-capture.ps1", import.meta.url));
}

export function assertWindowIdentity(identity: WindowIdentity): void {
  try {
    assertUint64Decimal(identity.hwnd, "hwnd");
    assertPid(identity.pid);
    assertUint64Decimal(identity.processStartTime, "processStartTime");
  } catch {
    throw invalidInput("window identity is invalid", "identity");
  }
}

/** Argument array for the fixed helper. There is no command-line string and no shell. */
export function helperLaunch(
  request: HelperRequest,
  scriptPath = windowsHelperScriptPath(),
): HelperLaunch {
  const prefix = [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-WindowStyle",
    "Hidden",
    "-File",
    scriptPath,
  ];
  const args =
    request.op === "list"
      ? [...prefix, "list"]
      : [
          ...prefix,
          "capture",
          request.hwnd,
          String(request.pid),
          request.processStartTime,
          request.outputDirectory,
        ];
  for (const arg of args) {
    if (arg.includes("\0") || arg.includes("\r") || arg.includes("\n")) {
      throw invalidInput("helper argument is invalid", "input");
    }
  }
  return { command: POWERSHELL_EXE, args, shell: false, windowsHide: true };
}

export function createPowerShellRunner(
  scriptPath = windowsHelperScriptPath(),
  dependencies?: { runProcess?: typeof runFixedProcess },
): HelperRunner {
  // Test seam. Production uses the fixed PowerShell process.
  const runProcess = dependencies?.runProcess ?? runFixedProcess;
  return {
    async run(request, signal, timeoutMs) {
      const launch = helperLaunch(request, scriptPath);
      if (signal.aborted) throw cancelled();
      // powershell.exe exists on Windows, so a missing -File is not spawn
      // ENOENT. Cold start can outlast the grace period and look like a
      // timeout. A script that exists is still launched, and one that hangs
      // still hits the process timeout below.
      await assertHelperScript(scriptPath);
      try {
        return await runProcess({
          command: launch.command,
          args: launch.args,
          signal,
          // The caller aborts `signal` at the real deadline. This limit only
          // kills a helper that ignored the abort.
          timeoutMs: timeoutMs + 1_000,
          maxStdoutBytes: 1024 * 1024,
        });
      } catch (error) {
        throw mapProcessError(error);
      }
    },
  };
}

export function parseHelperFailure(stdout: string): ScreenBackendError | undefined {
  const message = parseJson(stdout);
  if (message === undefined || message.ok !== false) return undefined;
  const code = typeof message.code === "string" ? message.code : "";
  const reason = HELPER_REASONS[code];
  if (reason === undefined) return unavailable("capture helper failed", "helper");
  return invalidInput(failureMessage(reason), reason);
}

export function parseWindowList(stdout: string): ListedWindow[] {
  const failure = parseHelperFailure(stdout);
  if (failure !== undefined) throw failure;
  const message = parseJson(stdout);
  if (message?.ok !== true || !Array.isArray(message.windows)) {
    throw unavailable("window list was malformed", "helper");
  }
  if (message.windows.length > MAX_WINDOWS) {
    throw unavailable("window list was malformed", "helper");
  }
  return message.windows.map((entry) => parseListedWindow(entry));
}

export function parseCaptureSize(stdout: string): { width: number; height: number } {
  const failure = parseHelperFailure(stdout);
  if (failure !== undefined) throw failure;
  const message = parseJson(stdout);
  if (message?.ok !== true || !isPositiveInt(message.width) || !isPositiveInt(message.height)) {
    throw unavailable("capture result was malformed", "helper");
  }
  if (message.width > MAX_EDGE || message.height > MAX_EDGE) {
    throw invalidInput("window size is outside the capture limit", "size");
  }
  return { width: message.width, height: message.height };
}

function parseListedWindow(entry: unknown): ListedWindow {
  if (!isRecord(entry)) throw unavailable("window list was malformed", "helper");
  const hwnd = entry.hwnd;
  const pid = entry.pid;
  const processStartTime = entry.processStartTime;
  const title = entry.title;
  const minimized = entry.minimized;
  const width = entry.width;
  const height = entry.height;
  const isProtected = entry.isProtected;
  if (
    typeof hwnd !== "string" ||
    typeof processStartTime !== "string" ||
    typeof title !== "string"
  ) {
    throw unavailable("window list was malformed", "helper");
  }
  if (
    typeof pid !== "number" ||
    typeof minimized !== "boolean" ||
    typeof isProtected !== "boolean"
  ) {
    throw unavailable("window list was malformed", "helper");
  }
  if (
    !isNonNegativeInt(width) ||
    !isNonNegativeInt(height) ||
    width > MAX_EDGE ||
    height > MAX_EDGE
  ) {
    throw unavailable("window list was malformed", "helper");
  }
  if (title.length < 1 || title.length > MAX_TITLE_CHARS) {
    throw unavailable("window list was malformed", "helper");
  }
  try {
    assertWindowIdentity({ hwnd, pid, processStartTime });
  } catch {
    throw unavailable("window list was malformed", "helper");
  }
  return { hwnd, pid, processStartTime, title, minimized, width, height, protected: isProtected };
}

function failureMessage(reason: string): string {
  switch (reason) {
    case "target-closed":
      return "window is closed";
    case "handle-reused":
      return "window handle was reused";
    case "minimized":
      return "window is minimized";
    case "protected":
      return "window capture is blocked";
    case "size":
      return "window size is outside the capture limit";
    case "unconfirmed":
      return "process identity could not be confirmed";
    default:
      return "capture request is invalid";
  }
}

async function assertHelperScript(scriptPath: string): Promise<void> {
  let info;
  try {
    info = await stat(scriptPath);
  } catch {
    throw helperUnavailable();
  }
  if (!info.isFile()) throw helperUnavailable();
}

function helperUnavailable(): ScreenBackendError {
  return unavailable("Windows capture helper is unavailable", "helper");
}

function mapProcessError(error: unknown): ScreenBackendError {
  if (!(error instanceof ProcessRunError)) return unavailable("capture helper failed", "helper");
  if (error.kind === "cancelled") return cancelled();
  if (error.kind === "timeout") return timedOut("capture helper timed out");
  if (error.kind === "spawn") return helperUnavailable();
  const failure = parseHelperFailure(error.stdout);
  if (failure !== undefined) return failure;
  return unavailable("capture helper failed", "helper");
}

function parseJson(stdout: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(stdout.trim()) as unknown;
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPositiveInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

function isNonNegativeInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}
