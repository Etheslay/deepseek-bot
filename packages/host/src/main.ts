/**
 * Host process entry (D12).
 *
 * Spawned by the desktop main under Node ≥ 24 (node:sqlite constraint,
 * ARCHITECTURE §4) with the data root resolved from the environment. Serves
 * the CONTRACTS §3 surface over stdio; credential decryption is delegated to
 * the parent per reference, so key material never enters this process except
 * transiently as the harness child's environment value.
 *
 * The desktop main builds this package (`pnpm --filter @deepseek-bot/host
 * build`) and spawns `node dist/main.js`; killing the child is the desktop's
 * emergency path, `host/shutdown` the graceful one. The credential/missed
 * channels go through holders: no request can reach the host before the
 * stdio loop starts, and attempts only run after a caller-driven request.
 */
import { createInterface } from "node:readline";
import { resolveDataRoot } from "@deepseek-bot/storage";
import type { ChatStreamNotice } from "./chat.js";
import type { ScheduleMissNotice } from "@deepseek-bot/runtime";
import { createHost } from "./host.js";
import { startStdioHost } from "./stdio.js";

function configuredPath(value: string | undefined): string | undefined {
  if (value === undefined || value.length === 0) return undefined;
  return value;
}

const credentialChannel: { resolve: (ref: string) => Promise<string> } = {
  resolve: () => Promise.reject(new Error("credential channel not ready")),
};
const missedChannel: { notify: (notices: ReadonlyArray<ScheduleMissNotice>) => void } = {
  notify: () => undefined,
};
const streamChannel: { notify: (notice: ChatStreamNotice) => void } = {
  notify: () => undefined,
};

function logHostError(error: unknown): void {
  const text = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`[host] ${text}\n`);
}

// A thrown scheduler tick or a stray rejection used to take the default Node
// path and exit. The desktop then answered every later call with
// "host process has exited". Log and keep the stdio loop up.
process.on("uncaughtException", logHostError);
process.on("unhandledRejection", logHostError);

/**
 * Startup failed before a Host existed. Stay on stdio and answer contract
 * calls with that error instead of exiting — an exit is what the desktop
 * surfaces as "host process has exited".
 */
async function serveStartupFailure(error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  logHostError(error);
  const lines = createInterface({ input: process.stdin, terminal: false });
  const write = (frame: Record<string, unknown>): void => {
    process.stdout.write(`${JSON.stringify(frame)}\n`);
  };
  for await (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    let frame: Record<string, unknown> | null = null;
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (typeof parsed === "object" && parsed !== null) frame = parsed as Record<string, unknown>;
    } catch {
      continue;
    }
    if (frame === null) continue;
    const method = frame.method;
    const id = frame.id;
    if (method === "host/shutdown") {
      write({ jsonrpc: "2.0", id, result: { ok: true } });
      return;
    }
    if (method === "contract/call") {
      write({
        jsonrpc: "2.0",
        id,
        error: {
          code: "RUNTIME_UNAVAILABLE",
          message,
          retryable: false,
          details: {},
        },
      });
    }
  }
}

/** Environment seed only. Empty or absent paths stay unconfigured. */
function whisperBoot(): { voice: { whisperBin?: string; whisperModel?: string } } | Record<string, never> {
  const whisperBin = configuredPath(process.env.DEEPSEEK_BOT_WHISPER_BIN);
  const whisperModel = configuredPath(process.env.DEEPSEEK_BOT_WHISPER_MODEL);
  if (whisperBin === undefined && whisperModel === undefined) return {};
  return {
    voice: {
      ...(whisperBin !== undefined ? { whisperBin } : {}),
      ...(whisperModel !== undefined ? { whisperModel } : {}),
    },
  };
}

let host: Awaited<ReturnType<typeof createHost>> | undefined = undefined;
try {
  host = await createHost({
    dataRoot: resolveDataRoot(),
    resolveApiKey: (credentialRef) => credentialChannel.resolve(credentialRef),
    onMissed: (notices) => missedChannel.notify(notices),
    onTurnStream: (notice) => streamChannel.notify(notice),
    ...(process.env.DEEPSEEK_BOT_SEARXNG_URL !== undefined
      ? { webSearch: { endpoint: process.env.DEEPSEEK_BOT_SEARXNG_URL } }
      : {}),
    ...whisperBoot(),
  });
} catch (error) {
  await serveStartupFailure(error);
}

if (host !== undefined) {
  const controller = startStdioHost({
    host,
    input: process.stdin,
    output: process.stdout,
  });
  credentialChannel.resolve = controller.resolveCredential;
  missedChannel.notify = controller.notifyMissed;
  streamChannel.notify = controller.notifyChatStream;
  try {
    host.start();
  } catch (error) {
    logHostError(error);
  }
  await controller.done;
}
