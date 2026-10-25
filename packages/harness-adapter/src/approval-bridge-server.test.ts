import { describe, expect, it } from "vitest";
import { NodeExecutionError } from "@deepseek-bot/runtime";
import type { AuthorizedAction, NodePermissionHandle, ToolActionRequest } from "@deepseek-bot/runtime";
import {
  decide,
  startApprovalBridgeServer,
  type ApprovalBridgeRequest,
  type RunningApprovalBridge,
} from "./approval-bridge-server.js";
import type { RegisteredSessionContext } from "./dsh-executor.js";

interface StubGate {
  readonly handle: NodePermissionHandle;
  readonly actions: ToolActionRequest[];
  resolveWith: "allow" | "deny" | "throw-unexpected";
}

function stubGate(resolveWith: StubGate["resolveWith"] = "allow"): StubGate {
  const actions: ToolActionRequest[] = [];
  const handle: NodePermissionHandle = {
    evaluate: async () => {
      throw new Error("evaluate is not used by the bridge");
    },
    authorize: async (action) => {
      actions.push(action);
      if (resolveWith === "deny") {
        throw new NodeExecutionError({
          code: "UNAUTHORIZED_PATH",
          message: "path escapes the workspace",
          retryable: false,
        });
      }
      if (resolveWith === "throw-unexpected") {
        throw new Error("gate exploded");
      }
      return { approvalId: null, actionDigest: "digest", resource: "resource" } satisfies AuthorizedAction;
    },
  };
  return { handle, actions, resolveWith };
}

function registryWith(sessionId: string, gate: StubGate) {
  const registered: RegisteredSessionContext = {
    runId: "run-1",
    nodeRunId: "node-run-1",
    permissions: gate.handle,
  };
  return (id: string): RegisteredSessionContext | undefined =>
    id === sessionId ? registered : undefined;
}

const writeAsk: ApprovalBridgeRequest = {
  sessionId: "session-1",
  toolName: "write",
  callId: "call_1",
  arguments: '{"file_path":"D:\\\\ws\\\\hello.txt","content":"hi"}',
};

describe("decide", () => {
  it("authorizes the mapped action and allows the ask", async () => {
    const gate = stubGate();
    const decision = await decide(writeAsk, registryWith("session-1", gate));
    expect(decision.outcome).toBe("allowed-once");
    expect(gate.actions).toHaveLength(1);
    expect(gate.actions[0]).toMatchObject({
      kind: "file.write",
      callId: "call_1",
      path: "D:\\ws\\hello.txt",
    });
  });

  it("rejects when the gate denies with a stable code", async () => {
    const gate = stubGate("deny");
    const decision = await decide(writeAsk, registryWith("session-1", gate));
    expect(decision.outcome).toBe("rejected");
    expect(decision.reason).toContain("UNAUTHORIZED_PATH");
  });

  it("fails closed on unknown sessions, unmapped tools and malformed asks", async () => {
    const gate = stubGate();
    expect((await decide(writeAsk, registryWith("other-session", gate))).outcome).toBe("unavailable");
    expect(
      (await decide({ ...writeAsk, toolName: "mystery_tool" }, registryWith("session-1", gate)))
        .outcome,
    ).toBe("rejected");
    expect(
      (await decide({ sessionId: "session-1" }, registryWith("session-1", gate))).outcome,
    ).toBe("unavailable");
    expect((await decide(writeAsk, () => undefined)).outcome).toBe("unavailable");
  });

  it("fails closed when the gate throws unexpectedly", async () => {
    const gate = stubGate("throw-unexpected");
    const decision = await decide(writeAsk, registryWith("session-1", gate));
    expect(decision.outcome).toBe("unavailable");
  });
});

describe("startApprovalBridgeServer", () => {
  let bridge: RunningApprovalBridge | undefined;

  async function started(gate: StubGate, sessionId = "session-1"): Promise<RunningApprovalBridge> {
    bridge = await startApprovalBridgeServer({ sessions: registryWith(sessionId, gate) });
    return bridge;
  }

  it("binds loopback on a random port and authorizes tokenized asks end to end", async () => {
    const gate = stubGate();
    bridge = await started(gate);
    expect(bridge.url.startsWith("http://127.0.0.1:")).toBe(true);
    const response = await fetch(`${bridge.url}/approval-requests`, {
      method: "POST",
      headers: { authorization: `Bearer ${bridge.token}`, "content-type": "application/json" },
      body: JSON.stringify(writeAsk),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ outcome: "allowed-once" });
    expect(gate.actions).toHaveLength(1);
  });

  it("rejects missing bearer tokens with 401", async () => {
    bridge = await started(stubGate());
    const response = await fetch(`${bridge.url}/approval-requests`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(writeAsk),
    });
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ outcome: "unavailable" });
  });

  it("answers 404 for other paths and methods", async () => {
    bridge = await started(stubGate());
    const get = await fetch(bridge.url, { headers: { authorization: `Bearer ${bridge.token}` } });
    expect(get.status).toBe(404);
    const wrong = await fetch(`${bridge.url}/approval-requests`, {
      method: "GET",
      headers: { authorization: `Bearer ${bridge.token}` },
    });
    expect(wrong.status).toBe(404);
  });

  it("answers 400 for malformed JSON bodies", async () => {
    bridge = await started(stubGate());
    const response = await fetch(`${bridge.url}/approval-requests`, {
      method: "POST",
      headers: { authorization: `Bearer ${bridge.token}`, "content-type": "application/json" },
      body: "{not json",
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ outcome: "unavailable" });
  });

  it("closes cleanly", async () => {
    bridge = await started(stubGate());
    await expect(bridge.close()).resolves.toBeUndefined();
  });
});
