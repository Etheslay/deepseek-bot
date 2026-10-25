import { describe, expect, it, vi } from "vitest";
import {
  apply,
  createApprovalAnswerer,
  readToolCallRecord,
  type ApprovalOutcome,
  type BridgeRequestLike,
} from "./index.js";

function sessionWithToolCall(callId: string, toolName = "write", args: unknown = { path: "a.txt" }) {
  const events = [
    { type: "session", data: {} },
    { type: "turn/start", data: {} },
    { type: "tool/call", data: { callId, name: toolName, arguments: args } },
  ];
  return {
    id: "session-1",
    seq: events.length,
    eventAt: (seq: number) => events[seq],
  };
}

function jsonResponse(payload: { outcome: ApprovalOutcome }): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("apply", () => {
  it("registers the waterfall listener when a bridge URL is available", () => {
    const handlers: Array<[string, unknown]> = [];
    apply({ on: (event, handler) => handlers.push([event, handler]) }, { bridgeUrl: "http://x" });
    expect(handlers).toEqual([["approval/request", expect.any(Function)]]);
  });

  it("registers nothing without a bridge URL (fail-closed by absence)", () => {
    const on = vi.fn();
    apply({ on }, {});
    expect(on).not.toHaveBeenCalled();
  });
});

describe("readToolCallRecord", () => {
  it("finds the recorded tool call by callId", () => {
    const session = sessionWithToolCall("call-1");
    expect(readToolCallRecord(session, "call-1")).toEqual({
      name: "write",
      arguments: { path: "a.txt" },
    });
  });

  it("returns undefined without a session, log reader, or match", () => {
    expect(readToolCallRecord(undefined, "call-1")).toBeUndefined();
    expect(readToolCallRecord({}, "call-1")).toBeUndefined();
    expect(readToolCallRecord(sessionWithToolCall("other"), "call-1")).toBeUndefined();
  });
});

describe("createApprovalAnswerer", () => {
  it("is undefined without a bridge URL (fail-closed by absence)", () => {
    expect(createApprovalAnswerer({})).toBeUndefined();
  });

  it("forwards the exact recorded arguments to the bridge and returns the outcome", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ outcome: "allowed-once" }));
    const answerer = createApprovalAnswerer({
      bridgeUrl: "http://127.0.0.1:1234",
      bridgeToken: "tok-1",
      fetchImpl,
    });
    expect(answerer).toBeDefined();
    const outcome = await answerer!(
      {
        agent: { session: sessionWithToolCall("call-1") },
        toolName: "write",
        callId: "call-1",
        reason: "needs write",
      } satisfies BridgeRequestLike,
      async () => "unavailable",
    );
    expect(outcome).toBe("allowed-once");
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("http://127.0.0.1:1234/approval-requests");
    expect((init!.headers as Record<string, string>)["authorization"]).toBe("Bearer tok-1");
    const body = JSON.parse(init!.body as string) as Record<string, unknown>;
    expect(body).toMatchObject({
      sessionId: "session-1",
      toolName: "write",
      callId: "call-1",
      recordedToolName: "write",
      arguments: { path: "a.txt" },
      reason: "needs write",
    });
  });

  it("delegates to next() when the ask carries no callId", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const answerer = createApprovalAnswerer({
      bridgeUrl: "http://127.0.0.1:1234",
      fetchImpl,
    })!;
    const next = vi.fn(async () => "unavailable" as ApprovalOutcome);
    const outcome = await answerer({ agent: { session: sessionWithToolCall("call-1") } }, next);
    expect(outcome).toBe("unavailable");
    expect(next).toHaveBeenCalledOnce();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reports cancelled when the request signal already aborted", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const answerer = createApprovalAnswerer({
      bridgeUrl: "http://127.0.0.1:1234",
      fetchImpl,
    })!;
    const controller = new AbortController();
    controller.abort();
    const outcome = await answerer(
      { callId: "call-1", signal: controller.signal },
      async () => "unavailable",
    );
    expect(outcome).toBe("cancelled");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("fails closed as unavailable on HTTP errors and unknown outcomes", async () => {
    const failing = createApprovalAnswerer({
      bridgeUrl: "http://127.0.0.1:1234",
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(new Response("boom", { status: 500 })),
    })!;
    expect(await failing({ callId: "call-1" }, async () => "unavailable")).toBe("unavailable");

    const garbage = createApprovalAnswerer({
      bridgeUrl: "http://127.0.0.1:1234",
      fetchImpl: vi
        .fn<typeof fetch>()
        .mockResolvedValue(jsonResponse({ outcome: "allowed-forever" as ApprovalOutcome })),
    })!;
    expect(await garbage({ callId: "call-1" }, async () => "unavailable")).toBe("unavailable");

    const throwing = createApprovalAnswerer({
      bridgeUrl: "http://127.0.0.1:1234",
      fetchImpl: vi.fn<typeof fetch>().mockRejectedValue(new Error("refused")),
    })!;
    expect(await throwing({ callId: "call-1" }, async () => "unavailable")).toBe("unavailable");
  });

  it("maps an abort during the round trip to cancelled", async () => {
    const controller = new AbortController();
    const answerer = createApprovalAnswerer({
      bridgeUrl: "http://127.0.0.1:1234",
      fetchImpl: vi.fn<typeof fetch>().mockRejectedValue(new Error("aborted")),
    })!;
    const signal = controller.signal;
    const pending = answerer({ callId: "call-1", signal }, async () => "unavailable");
    controller.abort();
    expect(await pending).toBe("cancelled");
  });
});
