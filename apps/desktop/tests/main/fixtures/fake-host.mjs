/**
 * Fake Host child for host-client tests: speaks the host stdio protocol.
 * Before answering its first bot.list it asks the parent back for a
 * credential ref (exercising credential/resolve in both directions — the
 * second ask uses a ref the parent decryptor rejects); it pushes one
 * schedule.missed notification shortly after startup; it exits on
 * host/shutdown.
 */
import { createInterface } from "node:readline";

const GOOD_REF = "cred:22222222-2222-4222-8222-222222222222";
const BAD_REF = "cred:33333333-3333-4333-8333-333333333333";

const lines = createInterface({ input: process.stdin, terminal: false });
let serial = 0;
let credentialAsks = 0;
let pendingContractId = null;

function write(frame) {
  process.stdout.write(`${JSON.stringify(frame)}\n`);
}

setTimeout(() => {
  write({
    jsonrpc: "2.0",
    method: "schedule.missed",
    params: {
      notices: [
        { scheduleId: "s1", workflowId: "w1", occurrenceUtc: "2026-01-01T00:00:00Z", reason: "test" },
      ],
    },
  });
  // B6: one live assistant segment on the chat.stream channel. A malformed
  // push rides ahead of it — the desktop must skip it (schema-validated) and
  // still forward the valid segment with a wire-real UUID botId.
  write({
    jsonrpc: "2.0",
    method: "chat.stream",
    params: { botId: 42, sessionId: "chat:bot-1:s1", text: "malformed" },
  });
  write({
    jsonrpc: "2.0",
    method: "chat.stream",
    params: {
      botId: "11111111-1111-4111-8111-111111111111",
      sessionId: "chat:11111111-1111-4111-8111-111111111111",
      text: "live segment",
    },
  });
}, 80).unref();

lines.on("line", (line) => {
  const trimmed = line.trim();
  if (trimmed.length === 0) return;
  let frame;
  try {
    frame = JSON.parse(trimmed);
  } catch {
    return;
  }
  const { id, method, params } = frame;
  if (method === undefined) {
    // Parent's answer to our credential/resolve request.
    if (pendingContractId !== null) {
      write({ jsonrpc: "2.0", id: pendingContractId, result: { bots: [{ id: "bot-1" }] } });
      pendingContractId = null;
    }
    return;
  }
  if (method === "credential/resolve") {
    // Late answer to a host-side ask: nothing pending, ignore.
    return;
  }
  if (method === "contract/call" && params.method === "bot.list") {
    const ref = credentialAsks === 0 ? GOOD_REF : BAD_REF;
    credentialAsks += 1;
    pendingContractId = id;
    write({ jsonrpc: "2.0", id: `cred_${++serial}`, method: "credential/resolve", params: { credentialRef: ref } });
    return;
  }
  if (method === "contract/call") {
    write({
      jsonrpc: "2.0",
      id,
      error: { code: "INVALID_INPUT", message: "workflow not found", retryable: false, details: {} },
    });
    return;
  }
  if (method === "host/shutdown") {
    write({ jsonrpc: "2.0", id, result: { ok: true } });
    setTimeout(() => process.exit(0), 10);
    return;
  }
});

process.on("SIGTERM", () => process.exit(0));
