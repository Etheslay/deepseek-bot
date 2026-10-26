import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryAuditSink } from "./audit.js";
import { ToolGateway, ToolRegistry } from "./gateway.js";
import { AskUserCoordinator, bindAskUserTool } from "./ask-user.js";

const caller = { id: "chat:session-1/bot-1" };
const input = {
  question: "Which private project should we work on?",
  options: [
    { id: "A", label: "Private project alpha" },
    { id: "B", label: "Private project beta" },
  ],
  allowOther: true,
};

function setup() {
  const questions = new AskUserCoordinator();
  const audit = new MemoryAuditSink();
  const registry = new ToolRegistry();
  registry.register(bindAskUserTool(questions));
  return { questions, audit, gateway: new ToolGateway({ registry, audit, grants: { check: async () => ({ allowed: true }) } }) };
}

async function pending(questions: AskUserCoordinator) {
  await vi.waitFor(() => expect(questions.listPending()).toHaveLength(1));
  return questions.listPending()[0]!;
}

afterEach(() => vi.useRealTimers());

describe("ask_user", () => {
  it("waits for a matching answer, consumes it once, and audits only digests", async () => {
    const { questions, audit, gateway } = setup();
    const result = gateway.call(caller, "ask_user", input);
    const request = await pending(questions);
    expect(audit.records).toHaveLength(0);
    expect(request).toMatchObject({ callerId: caller.id, ...input });
    expect(Date.parse(request.expiresAt) - Date.parse(request.createdAt)).toBe(30 * 60_000);
    questions.answer(request.requestId, caller.id, { optionId: "B" });
    await expect(result).resolves.toEqual({
      requestId: request.requestId,
      optionId: "B",
      text: input.options[1]!.label,
    });
    expect(questions.listPending()).toEqual([]);
    expect(() => questions.answer(request.requestId, caller.id, { optionId: "B" })).toThrow();
    expect(audit.records).toMatchObject([{ tool: "ask_user", caller: caller.id, outcome: "ok" }]);
    expect(audit.records[0]?.resultDigest).toHaveLength(64);
    expect(JSON.stringify(audit.records)).not.toContain("Private project");
    expect(JSON.stringify(audit.records)).not.toContain(input.question);
  });

  it("accepts nonempty other text and does not expose mutable pending records", async () => {
    const { questions, gateway } = setup();
    const result = gateway.call(caller, "ask_user", input);
    const request = await pending(questions);
    request.options[0]!.label = "tampered";
    expect(questions.listPending()[0]?.options[0]?.label).toBe(input.options[0]!.label);
    questions.answer(request.requestId, caller.id, { text: "  A private alternative  " });
    await expect(result).resolves.toEqual({
      requestId: request.requestId,
      text: "A private alternative",
    });
  });

  it.each([
    { ...input, question: " " },
    { ...input, extra: true },
    { ...input, options: [input.options[0]] },
    { ...input, options: Array.from({ length: 5 }, () => input.options[0]) },
    {
      ...input,
      options: [
        { id: "A", label: "a" },
        { id: "A", label: "b" },
      ],
    },
    {
      ...input,
      options: [
        { id: "A", label: "a" },
        { id: "E", label: "b" },
      ],
    },
    {
      ...input,
      options: [
        { id: "A", label: " " },
        { id: "B", label: "b" },
      ],
    },
  ])("rejects invalid questions before creating pending state", async (invalid) => {
    const { questions, audit, gateway } = setup();
    await expect(gateway.call(caller, "ask_user", invalid)).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    expect(questions.listPending()).toEqual([]);
    expect(audit.records).toMatchObject([{ outcome: "rejected", code: "INVALID_INPUT" }]);
  });

  it("rejects mismatched and malformed answers without consuming the request", async () => {
    const { questions, gateway } = setup();
    const result = gateway.call(caller, "ask_user", { ...input, allowOther: false });
    const request = await pending(questions);
    for (const answer of [
      { optionId: "D" },
      { text: " " },
      { text: "other" },
      { optionId: "A", text: "both" },
      { optionId: "A", extra: true },
    ]) {
      expect(() => questions.answer(request.requestId, caller.id, answer)).toThrow();
    }
    expect(() =>
      questions.answer(request.requestId, "another-caller", { optionId: "A" }),
    ).toThrow();
    expect(() => questions.cancel(request.requestId, "another-caller")).toThrow();
    questions.answer(request.requestId, caller.id, { optionId: "A" });
    await expect(result).resolves.toMatchObject({ optionId: "A", text: input.options[0]!.label });
  });

  it("keeps simultaneous callers isolated", async () => {
    const { questions, gateway } = setup();
    const first = gateway.call(caller, "ask_user", input);
    const secondCaller = { id: "chat:session-2/bot-2" };
    const second = gateway.call(secondCaller, "ask_user", input);
    await vi.waitFor(() => expect(questions.listPending()).toHaveLength(2));
    const a = questions.listPending(caller.id)[0]!;
    const b = questions.listPending(secondCaller.id)[0]!;
    expect(a.requestId).not.toBe(b.requestId);
    questions.answer(b.requestId, secondCaller.id, { optionId: "B" });
    await expect(second).resolves.toMatchObject({ optionId: "B" });
    expect(questions.listPending()).toHaveLength(1);
    questions.answer(a.requestId, caller.id, { optionId: "A" });
    await expect(first).resolves.toMatchObject({ optionId: "A" });
  });

  it("expires after 30 minutes and rejects late answers even before timer delivery", async () => {
    vi.useFakeTimers();
    const { questions, audit, gateway } = setup();
    const failed = expect(gateway.call(caller, "ask_user", input)).rejects.toMatchObject({
      code: "TOOL_TIMEOUT",
    });
    await vi.advanceTimersByTimeAsync(0);
    const request = questions.listPending()[0]!;
    vi.setSystemTime(Date.now() + 30 * 60_000);
    expect(() => questions.answer(request.requestId, caller.id, { optionId: "A" })).toThrow();
    await failed;
    expect(questions.listPending()).toEqual([]);
    expect(audit.records).toMatchObject([{ outcome: "error", code: "TOOL_TIMEOUT" }]);
  });

  it("expires by timer and clears the pending request", async () => {
    vi.useFakeTimers();
    const { questions, gateway } = setup();
    const failed = expect(gateway.call(caller, "ask_user", input)).rejects.toMatchObject({
      code: "TOOL_TIMEOUT",
    });
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    await failed;
    expect(questions.listPending()).toEqual([]);
  });

  it("cancels through the trusted control and through the caller signal", async () => {
    const { questions, audit, gateway } = setup();
    const failed = expect(gateway.call(caller, "ask_user", input)).rejects.toMatchObject({
      code: "CANCELLED",
    });
    const request = await pending(questions);
    questions.cancel(request.requestId, caller.id);
    await failed;
    const controller = new AbortController();
    const aborted = expect(
      gateway.call(caller, "ask_user", input, { signal: controller.signal }),
    ).rejects.toMatchObject({ code: "CANCELLED" });
    await pending(questions);
    controller.abort("secret abort reason");
    await aborted;
    expect(questions.listPending()).toEqual([]);
    expect(audit.records).toHaveLength(2);
    expect(JSON.stringify(audit.records)).not.toContain("secret abort reason");
  });

  it("does not create a request for an already cancelled caller", async () => {
    const { questions, gateway } = setup();
    await expect(
      gateway.call(caller, "ask_user", input, { signal: AbortSignal.abort() }),
    ).rejects.toMatchObject({ code: "CANCELLED" });
    expect(questions.listPending()).toEqual([]);
  });

  it("rejects active and future waits when closed, with failure audit", async () => {
    const { questions, audit, gateway } = setup();
    const failed = expect(gateway.call(caller, "ask_user", input)).rejects.toMatchObject({
      code: "RUNTIME_UNAVAILABLE",
    });
    await pending(questions);
    questions.close();
    questions.close();
    await failed;
    await expect(gateway.call(caller, "ask_user", input)).rejects.toMatchObject({
      code: "RUNTIME_UNAVAILABLE",
    });
    expect(questions.listPending()).toEqual([]);
    expect(audit.records).toMatchObject([{ outcome: "error" }, { outcome: "error" }]);
    expect(JSON.stringify(audit.records)).not.toContain(input.question);
  });

  it("keeps answer and cancel outside the model capability registry", async () => {
    const { gateway } = setup();
    expect(gateway.capabilities.list().map((capability) => capability.name)).toEqual(["ask_user"]);
    await expect(gateway.call(caller, "answer_ask_user", {})).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    await expect(gateway.call(caller, "cancel_ask_user", {})).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
  });
});
