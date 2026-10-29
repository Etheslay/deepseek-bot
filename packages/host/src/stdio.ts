/**
 * stdio serving for the Host process (D12, ARCHITECTURE §1/§5).
 *
 * The desktop main spawns the Host as a child process and speaks newline
 * delimited JSON-RPC 2.0 over stdio — private IPC, no sockets (ARCHITECTURE
 * §5: 优先私有 IPC). Contract calls use the JSON-RPC method `contract/call`
 * with the CONTRACTS §1 envelope as params ({protocolVersion, requestId,
 * method, payload}); responses are JSON-RPC results, failures carry the
 * stable error object ({code, message, retryable, details}).
 *
 * Two server→client channels exist:
 * - `credential/resolve` request: the Host holds only credential refs; the
 *   desktop main decrypts (safeStorage) and answers. An unanswered or failed
 *   request surfaces as a failed key resolution, never as a degraded secret.
 * - `schedule.missed` notification: skip-and-notify notices (FR-08) pushed
 *   to the desktop for UI surfacing.
 * - `host/shutdown` client→server request stops the host gracefully so the
 *   desktop controls teardown instead of killing the process.
 */
import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";
import { RequestEnvelopeSchema, isWithinMessageSizeLimit, type Method } from "@deepseek-bot/contracts";
import type { ChatStreamNotice } from "./chat.js";
import type { DeepSeekBotHost } from "./host.js";
import type { ScheduleMissNotice } from "@deepseek-bot/runtime";

export interface StdioHostOptions {
  readonly host: DeepSeekBotHost;
  readonly input: NodeJS.ReadableStream;
  readonly output: NodeJS.WritableStream;
  /** Bound on credential/resolve round trips. */
  readonly credentialTimeoutMs?: number;
}

export interface StdioHostController {
  /** Resolves when the peer closes stdin (the serving loop ends). */
  readonly done: Promise<void>;
  /** Server→client credential/resolve request (used as resolveApiKey). */
  readonly resolveCredential: (credentialRef: string) => Promise<string>;
  /** Push schedule.missed notices to the desktop (FR-08). */
  readonly notifyMissed: (notices: ReadonlyArray<ScheduleMissNotice>) => void;
  /** B6: push one live assistant segment of a running chat turn. */
  readonly notifyChatStream: (notice: ChatStreamNotice) => void;
}

interface PendingCredential {
  resolve: (result: { apiKey?: string; error?: string }) => void;
}

const DEFAULT_CREDENTIAL_TIMEOUT_MS = 10_000;

export function startStdioHost(options: StdioHostOptions): StdioHostController {
  const { host, input, output } = options;
  const credentialTimeoutMs = options.credentialTimeoutMs ?? DEFAULT_CREDENTIAL_TIMEOUT_MS;
  const pendingCredentials = new Map<string, PendingCredential>();

  const write = (frame: Record<string, unknown>): void => {
    output.write(`${JSON.stringify(frame)}\n`);
  };

  const resolveCredential = (credentialRef: string): Promise<string> =>
    new Promise<string>((resolve, reject) => {
      const id = `cred_${randomUUID()}`;
      const timer = setTimeout(() => {
        pendingCredentials.delete(id);
        reject(new Error(`credential decryption timed out for '${credentialRef}'`));
      }, credentialTimeoutMs);
      timer.unref?.();
      pendingCredentials.set(id, {
        resolve: (result) => {
          clearTimeout(timer);
          pendingCredentials.delete(id);
          if (result.error !== undefined || result.apiKey === undefined) {
            reject(
              new Error(result.error ?? `credential '${credentialRef}' could not be decrypted`),
            );
            return;
          }
          resolve(result.apiKey);
        },
      });
      write({
        jsonrpc: "2.0",
        id,
        method: "credential/resolve",
        params: { credentialRef },
      });
    });

  const notifyMissed = (notices: ReadonlyArray<ScheduleMissNotice>): void => {
    if (notices.length === 0) return;
    write({ jsonrpc: "2.0", method: "schedule.missed", params: { notices } });
  };

  // B6: the wire twin of schedule.missed — one server→client notification per
  // live assistant segment. Consumers that predate the channel ignore it.
  const notifyChatStream = (notice: ChatStreamNotice): void => {
    write({ jsonrpc: "2.0", method: "chat.stream", params: notice });
  };

  const handleFrame = (record: Record<string, unknown>): void => {
    const id = record.id;
    const method = record.method;
    if (typeof method !== "string") {
      // A response to a server→client request — the only such request is
      // credential/resolve, so route by id.
      if (typeof id === "string") {
        const result = record.result as { apiKey?: string; error?: string } | undefined;
        pendingCredentials.get(id)?.resolve(result ?? { error: "empty credential answer" });
      }
      return;
    }
    const params = (record.params ?? {}) as Record<string, unknown>;
    if (method === "credential/resolve" && typeof id === "string") {
      // A late error-style answer after its timeout has no pending entry; ignore.
      pendingCredentials.get(id)?.resolve(params as { apiKey?: string; error?: string });
      return;
    }
    void (async () => {
      if (method === "host/shutdown") {
        write({ jsonrpc: "2.0", id, result: { ok: true } });
        await host.shutdown();
        return;
      }
      if (method !== "contract/call") {
        write({
          jsonrpc: "2.0",
          id,
          error: {
            code: "INVALID_INPUT",
            message: `unknown stdio method '${method}'`,
            retryable: false,
            details: {},
          },
        });
        return;
      }
      const envelope = RequestEnvelopeSchema.safeParse(params);
      if (!envelope.success) {
        write({
          jsonrpc: "2.0",
          id,
          error: {
            code: "INVALID_INPUT",
            message: "request envelope is invalid",
            retryable: false,
            details: {
              issues: envelope.error.issues.map((issue) => ({
                path: issue.path.join("."),
                message: issue.message,
              })),
            },
          },
        });
        return;
      }
      if (!isWithinMessageSizeLimit(envelope.data.payload)) {
        write({
          jsonrpc: "2.0",
          id,
          error: {
            code: "INVALID_INPUT",
            message: "payload exceeds the message size limit",
            retryable: false,
            details: {},
          },
        });
        return;
      }
      try {
        const result = await host.handleMethod(
          envelope.data.method as Method,
          envelope.data.payload,
          envelope.data.requestId,
        );
        write({ jsonrpc: "2.0", id, result });
      } catch (error) {
        const code = (error as { code?: unknown }).code;
        write({
          jsonrpc: "2.0",
          id,
          error: {
            code: typeof code === "string" ? code : "RUNTIME_UNAVAILABLE",
            message: error instanceof Error ? error.message : String(error),
            retryable: (error as { retryable?: unknown }).retryable === true,
            details: (error as { details?: unknown }).details ?? {},
          },
        });
      }
    })();
  };

  const done = new Promise<void>((resolve) => {
    const lines = createInterface({ input, terminal: false });
    lines.on("line", (line) => {
      const trimmed = line.trim();
      if (trimmed.length === 0) return;
      let frame: unknown;
      try {
        frame = JSON.parse(trimmed);
      } catch {
        return;
      }
      if (typeof frame === "object" && frame !== null) {
        handleFrame(frame as Record<string, unknown>);
      }
    });
    lines.on("close", () => {
      for (const pending of pendingCredentials.values()) {
        pending.resolve({ error: "host stdin closed during credential resolution" });
      }
      resolve();
    });
  });

  return { done, resolveCredential, notifyMissed, notifyChatStream };
}
