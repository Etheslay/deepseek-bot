/**
 * D21 device input. One pointer move/click or one allowlisted key tap.
 * The helper receives an argument array. It does not receive a command or a path.
 */
import { stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { runWithDeadline } from "./deadline.js";
import {
  cancelled,
  invalidInput,
  timedOut,
  unavailable,
  type ScreenBackendError,
} from "./errors.js";
import { MAX_EDGE } from "./limits.js";
import { ProcessRunError, runFixedProcess } from "./process.js";
import { POWERSHELL_EXE, type HelperLaunch } from "./windows.js";

export const INPUT_TIMEOUT_MS = 5_000;

/** Virtual keys the helper accepts as the primary key. Modifiers are separate flags. */
export const DEVICE_KEY_CODES: Readonly<Record<string, number>> = {
  ...letterCodes(),
  ...digitCodes(),
  backspace: 0x08,
  tab: 0x09,
  enter: 0x0d,
  escape: 0x1b,
  space: 0x20,
  pageup: 0x21,
  pagedown: 0x22,
  end: 0x23,
  home: 0x24,
  left: 0x25,
  up: 0x26,
  right: 0x27,
  down: 0x28,
  delete: 0x2e,
  ...functionCodes(),
};

export function allowedVirtualKeys(): number[] {
  return [...new Set(Object.values(DEVICE_KEY_CODES))].sort((left, right) => left - right);
}

export interface DevicePointerRequest {
  kind: "pointer";
  gesture: "move" | "click";
  button: "left" | "right" | "middle";
  x: number;
  y: number;
}

export interface DeviceKeyRequest {
  kind: "key";
  name: string;
  action: "tap";
  shift: boolean;
  ctrl: boolean;
  alt: boolean;
}

export type DeviceInputRequest = DevicePointerRequest | DeviceKeyRequest;

export type DeviceHelperRequest =
  | {
      op: "pointer";
      gesture: "move" | "click";
      button: "left" | "right" | "middle";
      x: number;
      y: number;
    }
  | { op: "key"; virtualKey: number; shift: boolean; ctrl: boolean; alt: boolean };

export interface DeviceInputRunner {
  run(request: DeviceHelperRequest, signal: AbortSignal, timeoutMs: number): Promise<string>;
}

export interface DeviceInputBackend {
  readonly supported: boolean;
  perform(input: DeviceInputRequest, signal: AbortSignal): Promise<void>;
  close(): void;
}

export interface DeviceInputBackendOptions {
  helperScriptPath?: string;
  helperRunner?: DeviceInputRunner;
  timeoutMs?: number;
}

const HELPER_REASONS: Record<string, string> = {
  INPUT: "input",
  UNCONFIRMED: "unconfirmed",
};

export function inputScriptPath(): string {
  return fileURLToPath(new URL("../assets/win32-input.ps1", import.meta.url));
}

export function unavailableDeviceInputBackend(): DeviceInputBackend {
  return {
    supported: false,
    perform(): Promise<never> {
      return Promise.reject(unavailable("device input is not available"));
    },
    close(): void {},
  };
}

export function createDeviceInputBackend(
  options: DeviceInputBackendOptions = {},
): DeviceInputBackend {
  if (options.helperRunner === undefined && process.platform !== "win32") {
    return unavailableDeviceInputBackend();
  }
  const timeoutMs = options.timeoutMs ?? INPUT_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw invalidInput("timeout is invalid", "input");
  }
  const runner = options.helperRunner ?? createPowerShellInputRunner(options.helperScriptPath);
  const lifetime = new AbortController();
  let closed = false;
  return {
    supported: true,
    async perform(input, signal) {
      if (closed || lifetime.signal.aborted) throw unavailable("device input backend is closed");
      if (signal.aborted) throw cancelled("device input cancelled");
      const request = helperRequest(input);
      const linked = new AbortController();
      const abort = (): void => linked.abort();
      signal.addEventListener("abort", abort, { once: true });
      lifetime.signal.addEventListener("abort", abort, { once: true });
      try {
        const stdout = await runWithDeadline({
          signal: linked.signal,
          timeoutMs,
          run: (child) => runner.run(request, child, timeoutMs),
        });
        acceptHelperResult(stdout);
      } catch (error) {
        if (isBackend(error) && error.code === "TOOL_TIMEOUT") {
          throw timedOut("device input timed out");
        }
        if (isBackend(error) && error.code === "CANCELLED") {
          throw cancelled("device input cancelled");
        }
        throw error;
      } finally {
        signal.removeEventListener("abort", abort);
        lifetime.signal.removeEventListener("abort", abort);
      }
    },
    close() {
      if (closed) return;
      closed = true;
      lifetime.abort();
    },
  };
}

export function inputLaunch(
  request: DeviceHelperRequest,
  scriptPath = inputScriptPath(),
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
    request.op === "pointer"
      ? [
          ...prefix,
          "pointer",
          request.gesture,
          request.button,
          String(request.x),
          String(request.y),
        ]
      : [
          ...prefix,
          "key",
          String(request.virtualKey),
          request.shift ? "1" : "0",
          request.ctrl ? "1" : "0",
          request.alt ? "1" : "0",
        ];
  for (const arg of args) {
    if (arg.includes("\0") || arg.includes("\r") || arg.includes("\n")) {
      throw invalidInput("helper argument is invalid", "input");
    }
  }
  return { command: POWERSHELL_EXE, args, shell: false, windowsHide: true };
}

export function helperRequest(input: DeviceInputRequest): DeviceHelperRequest {
  if (input.kind === "pointer") {
    if (input.gesture !== "move" && input.gesture !== "click") {
      throw invalidInput("pointer gesture is invalid", "input");
    }
    if (input.button !== "left" && input.button !== "right" && input.button !== "middle") {
      throw invalidInput("pointer button is invalid", "input");
    }
    if (!isCoord(input.x) || !isCoord(input.y)) {
      throw invalidInput("pointer position is invalid", "input");
    }
    return { op: "pointer", gesture: input.gesture, button: input.button, x: input.x, y: input.y };
  }
  if (input.kind !== "key" || input.action !== "tap") {
    throw invalidInput("device input is invalid", "input");
  }
  const virtualKey = DEVICE_KEY_CODES[input.name];
  if (virtualKey === undefined) throw invalidInput("device key is unknown", "input");
  if (
    typeof input.shift !== "boolean" ||
    typeof input.ctrl !== "boolean" ||
    typeof input.alt !== "boolean"
  ) {
    throw invalidInput("device key modifiers are invalid", "input");
  }
  return { op: "key", virtualKey, shift: input.shift, ctrl: input.ctrl, alt: input.alt };
}

export function parseDeviceInputFailure(stdout: string): ScreenBackendError | undefined {
  const message = parseJson(stdout);
  if (message === undefined || message.ok !== false) return undefined;
  const code = typeof message.code === "string" ? message.code : "";
  const reason = HELPER_REASONS[code];
  if (reason === undefined) return unavailable("device input helper failed", "helper");
  return invalidInput(
    reason === "unconfirmed" ? "device input was not confirmed" : "device input was rejected",
    reason,
  );
}

export function createPowerShellInputRunner(
  scriptPath = inputScriptPath(),
  dependencies?: { runProcess?: typeof runFixedProcess },
): DeviceInputRunner {
  const runProcess = dependencies?.runProcess ?? runFixedProcess;
  return {
    async run(request, signal, timeoutMs) {
      const launch = inputLaunch(request, scriptPath);
      if (signal.aborted) throw cancelled("device input cancelled");
      await assertHelperScript(scriptPath);
      try {
        return await runProcess({
          command: launch.command,
          args: launch.args,
          signal,
          timeoutMs: timeoutMs + 1_000,
          maxStdoutBytes: 4_096,
        });
      } catch (error) {
        throw mapProcessError(error);
      }
    },
  };
}

function acceptHelperResult(stdout: string): void {
  const failure = parseDeviceInputFailure(stdout);
  if (failure !== undefined) throw failure;
  const message = parseJson(stdout);
  if (message?.ok !== true) throw unavailable("device input result was malformed", "helper");
}

function assertHelperScript(scriptPath: string): Promise<void> {
  return stat(scriptPath).then(
    (info) => {
      if (!info.isFile()) throw unavailable("device input helper is unavailable", "helper");
    },
    () => {
      throw unavailable("device input helper is unavailable", "helper");
    },
  );
}

function mapProcessError(error: unknown): ScreenBackendError {
  if (!(error instanceof ProcessRunError))
    return unavailable("device input helper failed", "helper");
  if (error.kind === "cancelled") return cancelled("device input cancelled");
  if (error.kind === "timeout") return timedOut("device input timed out");
  if (error.kind === "spawn") return unavailable("device input helper is unavailable", "helper");
  const failure = parseDeviceInputFailure(error.stdout);
  if (failure !== undefined) return failure;
  return unavailable("device input helper failed", "helper");
}

function isCoord(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= MAX_EDGE;
}

function letterCodes(): Record<string, number> {
  const codes: Record<string, number> = {};
  for (let index = 0; index < 26; index += 1) {
    codes[String.fromCharCode(97 + index)] = 0x41 + index;
  }
  return codes;
}

function digitCodes(): Record<string, number> {
  const codes: Record<string, number> = {};
  for (let index = 0; index < 10; index += 1) codes[String(index)] = 0x30 + index;
  return codes;
}

function functionCodes(): Record<string, number> {
  const codes: Record<string, number> = {};
  for (let index = 1; index <= 12; index += 1) codes[`f${index}`] = 0x70 + index - 1;
  return codes;
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

function isBackend(error: unknown): error is ScreenBackendError {
  return error instanceof Error && error.name === "ScreenBackendError";
}
