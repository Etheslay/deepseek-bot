/**
 * Host process client for the Electron main (D12).
 *
 * Spawns the built Host entry (`packages/host/dist/main.js`) under a real
 * Node ≥ 24 runtime (Electron 38's bundled Node has no `node:sqlite`,
 * ARCHITECTURE §4) and speaks its stdio protocol: `contract/call` requests
 * with CONTRACTS envelopes, `credential/resolve` answered through the
 * injected decryptor (safeStorage lives here, in main), `schedule.missed`
 * notifications forwarded to listeners, `host/shutdown` for teardown.
 *
 * This module stays Electron-free (plain child_process + readline) so it is
 * unit-testable against a fake host script.
 */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import {
  METHODS,
  RequestEnvelopeSchema,
  isWithinMessageSizeLimit,
  type Method,
} from "@deepseek-bot/contracts";

export type HostProcessStatus = "starting" | "ready" | "exited";

export interface HostProcessClientOptions {
  /** Absolute path of the built host entry (dist/main.js). */
  readonly entryPath: string;
  /** Node ≥ 24 executable running the host; defaults to "node" on PATH. */
  readonly nodePath?: string;
  /** Data root handed to the host through the environment. */
  readonly dataRoot: string;
  /** Decrypt a credential ref (safeStorage in main). Failures reach the host as failed key resolutions. */
  readonly decryptCredential: (credentialRef: string) => Promise<string>;
  /** Extra child environment (test scenario knobs). */
  readonly childEnv?: (parentEnv: NodeJS.ProcessEnv) => NodeJS.ProcessEnv;
}

export interface ScheduleMissedNotice {
  readonly scheduleId: string;
  readonly workflowId: string;
  readonly occurrenceUtc: string;
  readonly reason: string;
}

/** Error surfaced to the renderer for a failed host call (CONTRACTS §6 shape). */
export class HostCallError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly details: Record<string, unknown>;

  constructor(error: { code: string; message: string; retryable?: boolean; details?: unknown }) {
    super(error.message);
    this.name = "HostCallError";
    this.code = error.code;
    this.retryable = error.retryable === true;
    this.details = (error.details ?? {}) as Record<string, unknown>;
  }
}

export interface HostProcessClient {
  call(method: Method, payload: unknown): Promise<unknown>;
  onMissed(listener: (notices: ReadonlyArray<ScheduleMissedNotice>) => void): () => void;
  onStatus(listener: (status: HostProcessStatus) => void): () => void;
  /** Current process status (ready until the child exits). */
  readonly status: HostProcessStatus;
  /** Graceful teardown: host/shutdown request, exit wait, kill fallback. */
  shutdown(): Promise<void>;
}

const CREDENTIAL_TIMEOUT_MS = 15_000;
const SHUTDOWN_GRACE_MS = 3_000;

export function spawnHostProcess(options: HostProcessClientOptions): HostProcessClient {
  const child = spawn(options.nodePath ?? "node", [options.entryPath], {
    env: {
      ...process.env,
      DEEPSEEK_BOT_DATA_ROOT: options.dataRoot,
      ...(options.childEnv !== undefined ? options.childEnv(process.env) : {}),
    },
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  child.stdin.on("error", () => {
    // Writes racing host death surface through the exit handler instead.
  });

  let status: HostProcessStatus = "starting";
  const statusListeners = new Set<(status: HostProcessStatus) => void>();
  const missedListeners = new Set<(notices: ReadonlyArray<ScheduleMissedNotice>) => void>();
  const pending = new Map<
    string,
    { resolve: (result: unknown) => void; reject: (error: Error) => void }
  >();
  const pendingCredentials = new Map<
    string,
    { credentialRef: string; timer: NodeJS.Timeout }
  >();
  let callSerial = 0;
  let exited = false;

  const setStatus = (next: HostProcessStatus): void => {
    status = next;
    for (const listener of statusListeners) listener(next);
  };

  const failPending = (message: string): void => {
    const waiters = [...pending.values()];
    pending.clear();
    for (const waiter of waiters) {
      waiter.reject(new HostCallError({ code: "RUNTIME_UNAVAILABLE", message, retryable: true }));
    }
  };

  child.stderr.setEncoding("utf8");
  child.stderr.on("data", () => {
    // Diagnostics stay local; the host's error frames carry the wire facts.
  });
  child.once("exit", (code) => {
    exited = true;
    setStatus("exited");
    failPending(`host process exited (code ${code ?? "unknown"})`);
    for (const [, entry] of pendingCredentials) clearTimeout(entry.timer);
    pendingCredentials.clear();
  });

  const write = (frame: Record<string, unknown>): void => {
    child.stdin.write(`${JSON.stringify(frame)}\n`);
  };

  const lines = createInterface({ input: child.stdout, terminal: false });
  lines.on("line", (line) => {
    const trimmed = line.trim();
    if (trimmed.length === 0) return;
    let frame: unknown;
    try {
      frame = JSON.parse(trimmed);
    } catch {
      return;
    }
    if (typeof frame !== "object" || frame === null) return;
    const record = frame as Record<string, unknown>;
    const id = record.id;
    const method = record.method;
    if (method === "credential/resolve" && typeof id === "string") {
      const params = (record.params ?? {}) as { credentialRef?: unknown };
      const credentialRef =
        typeof params.credentialRef === "string" ? params.credentialRef : "";
      const timer = setTimeout(() => {
        pendingCredentials.delete(id);
        write({
          jsonrpc: "2.0",
          id,
          result: { error: `credential decryption timed out for '${credentialRef}'` },
        });
      }, CREDENTIAL_TIMEOUT_MS);
      timer.unref?.();
      pendingCredentials.set(id, { credentialRef, timer });
      void options
        .decryptCredential(credentialRef)
        .then((apiKey) => {
          if (!pendingCredentials.has(id)) return;
          clearTimeout(timer);
          pendingCredentials.delete(id);
          write({ jsonrpc: "2.0", id, result: { apiKey } });
        })
        .catch((error: unknown) => {
          if (!pendingCredentials.has(id)) return;
          clearTimeout(timer);
          pendingCredentials.delete(id);
          write({
            jsonrpc: "2.0",
            id,
            result: { error: error instanceof Error ? error.message : String(error) },
          });
        });
      return;
    }
    if (method === "schedule.missed") {
      const params = (record.params ?? {}) as { notices?: ScheduleMissedNotice[] };
      if (Array.isArray(params.notices)) {
        for (const listener of missedListeners) listener(params.notices);
      }
      return;
    }
    if (typeof id === "string" && pending.has(id)) {
      const waiter = pending.get(id)!;
      pending.delete(id);
      if (record.error !== undefined && typeof record.error === "object" && record.error !== null) {
        const wireError = record.error as {
          code?: unknown;
          message?: unknown;
          retryable?: unknown;
          details?: unknown;
        };
        waiter.reject(
          new HostCallError({
            code: typeof wireError.code === "string" ? wireError.code : "RUNTIME_UNAVAILABLE",
            message: typeof wireError.message === "string" ? wireError.message : "host call failed",
            retryable: wireError.retryable === true,
            details: wireError.details,
          }),
        );
      } else {
        waiter.resolve(record.result);
      }
    }
  });

  setStatus("ready");

  return {
    call(method: Method, payload: unknown): Promise<unknown> {
      if (exited) {
        return Promise.reject(
          new HostCallError({ code: "RUNTIME_UNAVAILABLE", message: "host process has exited", retryable: false }),
        );
      }
      const envelope = {
        protocolVersion: "0.1",
        requestId: randomUUID(),
        method,
        payload: payload ?? {},
      };
      const parsed = RequestEnvelopeSchema.safeParse(envelope);
      if (!parsed.success || !isWithinMessageSizeLimit(parsed.data.payload)) {
        return Promise.reject(
          new HostCallError({
            code: "INVALID_INPUT",
            message: `request for '${method}' is invalid or oversized`,
            retryable: false,
            details: {},
          }),
        );
      }
      const id = `call_${++callSerial}`;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        write({ jsonrpc: "2.0", id, method: "contract/call", params: envelope });
      });
    },
    onMissed(listener): () => void {
      missedListeners.add(listener);
      return () => missedListeners.delete(listener);
    },
    onStatus(listener): () => void {
      statusListeners.add(listener);
      return () => statusListeners.delete(listener);
    },
    get status(): HostProcessStatus {
      return status;
    },
    shutdown(): Promise<void> {
      if (exited) return Promise.resolve();
      return new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          child.kill("SIGKILL");
          resolve();
        }, SHUTDOWN_GRACE_MS);
        timer.unref?.();
        child.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
        write({ jsonrpc: "2.0", id: `shutdown_${randomUUID()}`, method: "host/shutdown" });
      });
    },
  };
}

/** The method allowlist the main process enforces before forwarding. */
export function isAllowedHostMethod(method: unknown): method is Method {
  return typeof method === "string" && (METHODS as readonly string[]).includes(method);
}
