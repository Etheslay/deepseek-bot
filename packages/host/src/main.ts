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
import { resolveDataRoot } from "@deepseek-bot/storage";
import type { ChatStreamNotice } from "./chat.js";
import type { ScheduleMissNotice } from "@deepseek-bot/runtime";
import { createHost } from "./host.js";
import { startStdioHost } from "./stdio.js";

const credentialChannel: { resolve: (ref: string) => Promise<string> } = {
  resolve: () => Promise.reject(new Error("credential channel not ready")),
};
const missedChannel: { notify: (notices: ReadonlyArray<ScheduleMissNotice>) => void } = {
  notify: () => undefined,
};
const streamChannel: { notify: (notice: ChatStreamNotice) => void } = {
  notify: () => undefined,
};

const host = await createHost({
  dataRoot: resolveDataRoot(),
  resolveApiKey: (credentialRef) => credentialChannel.resolve(credentialRef),
  onMissed: (notices) => missedChannel.notify(notices),
  onTurnStream: (notice) => streamChannel.notify(notice),
  ...(process.env.DEEPSEEK_BOT_SEARXNG_URL !== undefined
    ? { webSearch: { endpoint: process.env.DEEPSEEK_BOT_SEARXNG_URL } }
    : {}),
  ...(process.env.DEEPSEEK_BOT_WHISPER_BIN !== undefined ||
  process.env.DEEPSEEK_BOT_WHISPER_MODEL !== undefined
    ? {
        voice: {
          ...(process.env.DEEPSEEK_BOT_WHISPER_BIN !== undefined
            ? { whisperBin: process.env.DEEPSEEK_BOT_WHISPER_BIN }
            : {}),
          ...(process.env.DEEPSEEK_BOT_WHISPER_MODEL !== undefined
            ? { whisperModel: process.env.DEEPSEEK_BOT_WHISPER_MODEL }
            : {}),
        },
      }
    : {}),
});
const controller = startStdioHost({
  host,
  input: process.stdin,
  output: process.stdout,
});
credentialChannel.resolve = controller.resolveCredential;
missedChannel.notify = controller.notifyMissed;
streamChannel.notify = controller.notifyChatStream;
host.start();
await controller.done;
