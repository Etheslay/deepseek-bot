/**
 * Fake Harness runtime for adapter tests: speaks the verified 0.2.1-rc.2 wire
 * protocol (newline-delimited JSON-RPC 2.0 over stdio, protocol/src/transport.ts)
 * with scriptable scenarios. Not shipped — test scaffolding excluded from coverage.
 *
 * Scenarios (env FAKE_SCENARIO, default "ok"):
 *  ok         turn completes: receipt → assistant text → turn/end completed → idle
 *  tool       like ok, with tool/call and tool/result events
 *  hang       receipt + running status, never idle (cancellation tests)
 *  crash      receipt, then exit 1 (transport loss mid-turn)
 *  ratelimit  initialize fails with a rate-limit error response
 *  authfail   initialize succeeds; session/prompt fails with an auth error
 *  echo-model like ok, but the final response echoes initialize model + prompt
 *
 * Records every request and the child environment to FAKE_RECORD_DIR (JSONL)
 * so tests can assert what the adapter actually sent.
 */
import { createInterface } from "node:readline";
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const scenario = process.env["FAKE_SCENARIO"] ?? "ok";
const recordDir = process.env["FAKE_RECORD_DIR"];
let sessionId = null;
let lastPrompt = null;
let initializeParams = null;
let serial = 0;

function record(entry) {
  if (recordDir === undefined) return;
  mkdirSync(recordDir, { recursive: true });
  appendFileSync(join(recordDir, "fake-harness.jsonl"), `${JSON.stringify(entry)}\n`);
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function respond(id, result) {
  send({ jsonrpc: "2.0", id, result });
}

function respondError(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

function notify(method, params) {
  send({ jsonrpc: "2.0", method, params });
}

function sessionEvent(event) {
  serial += 1;
  notify("session.event", {
    sessionId,
    event: { type: event.type, seq: serial, time: Date.now(), data: event.data ?? {} },
  });
}

function status(value) {
  notify("session.status", { sessionId, status: value });
}

function emitTurnCompletion(messageId, text) {
  sessionEvent({ type: "agent/inbox/spliced", data: { target: "next-turn", inserted: [{ id: messageId }] } });
  sessionEvent({ type: "turn/start", data: { turn: 1 } });
  sessionEvent({ type: "assistant/message", data: { message: { role: "assistant", content: [{ type: "text", text }] } } });
  sessionEvent({ type: "turn/end", data: { reason: { kind: "completed" } } });
  status("running");
  status("idle");
}

const lines = createInterface({ input: process.stdin, terminal: false });
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
  record({ method, params });
  switch (method) {
    case "initialize": {
      if (scenario === "ratelimit") {
        respondError(id, -32000, "model route rate limited (429)");
        return;
      }
      initializeParams = params;
      record({
        env: {
          DSH_HOME: process.env.DSH_HOME,
          DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
        },
      });
      respond(id, { serverInfo: { name: "fake-harness-sdk-runtime", version: "0.0.1-test" } });
      return;
    }
    case "session/prompt": {
      sessionId = params.sessionId;
      lastPrompt = (params.contentBlocks ?? [])
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n");
      if (scenario === "authfail") {
        respondError(id, -32001, "authentication failed: invalid api key");
        return;
      }
      const messageId = `msg-${serial + 1}`;
      respond(id, { messageId });
      if (scenario === "crash") {
        serial += 1;
        notify("session.event", {
          sessionId,
          event: { type: "agent/inbox/spliced", seq: serial, time: Date.now(), data: { inserted: [{ id: messageId }] } },
        });
        setTimeout(() => process.exit(1), 20);
        return;
      }
      if (scenario === "hang") {
        sessionEvent({ type: "agent/inbox/spliced", data: { inserted: [{ id: messageId }] } });
        status("running");
        return;
      }
      const text =
        scenario === "echo-model"
          ? `model=${initializeParams.model} provider=${initializeParams.provider} cwd=${initializeParams.cwd}\n${lastPrompt}`
          : "fake final response";
      if (scenario === "tool") {
        sessionEvent({ type: "agent/inbox/spliced", data: { inserted: [{ id: messageId }] } });
        sessionEvent({ type: "tool/call", data: { callId: "call-1", name: "write", arguments: { path: "hello.txt" } } });
        sessionEvent({ type: "tool/result", data: { callId: "call-1", isError: false, meta: { operation: "write", path: "hello.txt" } } });
        emitTurnCompletion(messageId, text);
        return;
      }
      emitTurnCompletion(messageId, text);
      return;
    }
    case "session/resume": {
      respond(id, {});
      return;
    }
    case "session/wait": {
      respond(id, {});
      return;
    }
    case "shutdown": {
      respond(id, {});
      setTimeout(() => process.exit(0), 10);
      return;
    }
    default: {
      if (id !== undefined) respondError(id, -32601, `method not found: ${method}`);
    }
  }
});

if (scenario === "stderr-noise") {
  process.stderr.write("fake harness diagnostic line\n");
}

process.on("SIGTERM", () => process.exit(0));
