import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHost, type DeepSeekBotHost } from "./host.js";

const roots: string[] = [];
const hosts: DeepSeekBotHost[] = [];
const caller = { id: "chat:session-1/bot-1" };
const question = {
  question: "Private question",
  options: [
    { id: "A", label: "Private alpha" },
    { id: "B", label: "Private beta" },
  ],
  allowOther: true,
};

async function makeHost(dataRoot = mkdtempSync(join(tmpdir(), "dsb-ask-user-"))) {
  roots.push(dataRoot);
  const host = await createHost({ dataRoot, resolveApiKey: async () => "unused" });
  hosts.push(host);
  return host;
}

afterEach(async () => {
  for (const host of hosts.splice(0)) await host.shutdown().catch(() => undefined);
  for (const root of new Set(roots.splice(0))) rmSync(root, { recursive: true, force: true });
});

describe("Host ask_user controls", () => {
  it("registers ask_user without exposing answer or cancel as model tools", async () => {
    const host = await makeHost();
    expect(host.agentTools.capabilities.list().map((tool) => tool.name)).toContain("ask_user");
    await expect(host.agentTools.call(caller, "answer_ask_user", {})).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    await expect(host.agentTools.call(caller, "cancel_ask_user", {})).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    await expect(host.handleMethod("ask_user" as never, {})).rejects.toThrow();
  });

  it("answers through the trusted Host control and writes digest-only audit", async () => {
    const host = await makeHost();
    const result = host.agentTools.call(caller, "ask_user", question);
    await vi.waitFor(() => expect(host.userQuestions.listPending(caller.id)).toHaveLength(1));
    const request = host.userQuestions.listPending(caller.id)[0]!;
    host.userQuestions.answer(request.requestId, caller.id, { text: "Private answer" });
    await expect(result).resolves.toMatchObject({
      requestId: request.requestId,
      text: "Private answer",
    });
    const audit = readFileSync(join(host.layout.logs, "agent-tools-audit.jsonl"), "utf8");
    expect(JSON.parse(audit.trim())).toMatchObject({
      tool: "ask_user",
      caller: caller.id,
      outcome: "ok",
    });
    expect(audit).not.toContain("Private");
  });

  it("cancels pending calls through Host and rejects mismatched caller ids", async () => {
    const host = await makeHost();
    const failed = expect(host.agentTools.call(caller, "ask_user", question)).rejects.toMatchObject(
      { code: "CANCELLED" },
    );
    await vi.waitFor(() => expect(host.userQuestions.listPending()).toHaveLength(1));
    const request = host.userQuestions.listPending()[0]!;
    expect(() =>
      host.userQuestions.answer(request.requestId, "another-session", { optionId: "A" }),
    ).toThrow();
    host.userQuestions.cancel(request.requestId, caller.id);
    await failed;
    expect(host.userQuestions.listPending()).toEqual([]);
  });

  it("closes pending calls on shutdown and never restores them on restart", async () => {
    const host = await makeHost();
    const failed = expect(host.agentTools.call(caller, "ask_user", question)).rejects.toMatchObject(
      { code: "RUNTIME_UNAVAILABLE" },
    );
    await vi.waitFor(() => expect(host.userQuestions.listPending()).toHaveLength(1));
    const request = host.userQuestions.listPending()[0]!;
    await host.shutdown();
    await failed;
    expect(host.userQuestions.listPending()).toEqual([]);
    const restarted = await makeHost(roots[0]!);
    expect(restarted.userQuestions.listPending()).toEqual([]);
    expect(() =>
      restarted.userQuestions.answer(request.requestId, caller.id, { optionId: "A" }),
    ).toThrow();
    await expect(host.agentTools.call(caller, "ask_user", question)).rejects.toMatchObject({
      code: "RUNTIME_UNAVAILABLE",
    });
    const audit = readFileSync(join(host.layout.logs, "agent-tools-audit.jsonl"), "utf8");
    expect(audit).not.toContain("Private");
    expect(JSON.parse(audit.trim().split("\n")[0]!)).toMatchObject({
      outcome: "error",
      code: "RUNTIME_UNAVAILABLE",
    });
  });
});
