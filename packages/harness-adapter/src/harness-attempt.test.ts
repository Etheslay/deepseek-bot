import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { NodeExecutionError } from "@deepseek-bot/runtime";
import { HarnessAttempt } from "./harness-attempt.js";

const fakeHarness = fileURLToPath(new URL("./testing/fake-harness.mjs", import.meta.url));

const roots: string[] = [];
afterAll(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "dsb-adapter-"));
  roots.push(root);
  return root;
}

function attemptOptions(scenario: string, root: string) {
  return {
    command: process.execPath,
    args: [fakeHarness],
    cwd: root,
    env: {
      ...process.env,
      FAKE_SCENARIO: scenario,
      DSH_HOME: join(root, "dsh-home"),
    },
  };
}

describe("HarnessAttempt", () => {
  it("performs the initialize handshake and reports the server identity", async () => {
    const root = makeRoot();
    const attempt = new HarnessAttempt(attemptOptions("ok", root));
    const serverInfo = await attempt.start({
      cwd: root,
      provider: "deepseek-official",
      model: "deepseek-chat",
    });
    expect(serverInfo.name).toBe("fake-harness-sdk-runtime");
    expect(serverInfo.version).toBe("0.0.1-test");
    await expect(attempt.shutdown()).resolves.toBeUndefined();
  });

  it("settles a completed turn with events, final response and turn-end kind", async () => {
    const root = makeRoot();
    const attempt = new HarnessAttempt(attemptOptions("ok", root));
    await attempt.start({ cwd: root, provider: "deepseek-official", model: "deepseek-chat" });
    const outcome = await attempt.runTurn("session-1", "do the thing");
    expect(outcome.finalResponse).toBe("fake final response");
    expect(outcome.turnEndKind).toBe("completed");
    expect(outcome.events.map((event) => event.type)).toEqual([
      "agent/inbox/spliced",
      "turn/start",
      "assistant/message",
      "turn/end",
    ]);
    await attempt.shutdown();
    expect(attempt.exited).toBe(true);
  });

  it("collects tool events in wire order", async () => {
    const root = makeRoot();
    const attempt = new HarnessAttempt(attemptOptions("tool", root));
    await attempt.start({ cwd: root, provider: "deepseek-official", model: "deepseek-chat" });
    const live: string[] = [];
    const outcome = await attempt.runTurn("session-1", "write hello.txt", undefined, (event) => {
      live.push(event.type);
    });
    const toolCall = outcome.events.find((event) => event.type === "tool/call");
    const toolResult = outcome.events.find((event) => event.type === "tool/result");
    expect(toolCall?.data).toMatchObject({ callId: "call-1", name: "write" });
    expect(toolResult?.data).toMatchObject({ callId: "call-1", isError: false });
    // The live mirror saw the same wire order, receipt first.
    expect(live[0]).toBe("agent/inbox/spliced");
    expect(live).toContain("tool/call");
    expect(live).toContain("tool/result");
    expect(live.indexOf("tool/call")).toBeLessThan(live.indexOf("tool/result"));
    await attempt.shutdown();
  });

  it("classifies an aborted turn as CANCELLED", async () => {
    const root = makeRoot();
    const attempt = new HarnessAttempt(attemptOptions("hang", root));
    await attempt.start({ cwd: root, provider: "deepseek-official", model: "deepseek-chat" });
    const controller = new AbortController();
    const pending = attempt.runTurn("session-1", "long task", controller.signal);
    controller.abort();
    const error = await pending.catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(NodeExecutionError);
    expect((error as NodeExecutionError).code).toBe("CANCELLED");
    expect((error as NodeExecutionError).retryable).toBe(false);
    await attempt.dispose();
  });

  it("classifies transport loss mid-turn as retryable RUNTIME_UNAVAILABLE", async () => {
    const root = makeRoot();
    const attempt = new HarnessAttempt(attemptOptions("crash", root));
    await attempt.start({ cwd: root, provider: "deepseek-official", model: "deepseek-chat" });
    const error = await attempt.runTurn("session-1", "boom").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(NodeExecutionError);
    expect((error as NodeExecutionError).code).toBe("RUNTIME_UNAVAILABLE");
    expect((error as NodeExecutionError).retryable).toBe(true);
    expect((error as NodeExecutionError).message).toContain("exit code 1");
    await attempt.dispose();
  });

  it("maps wire error responses to stable codes", async () => {
    const root = makeRoot();
    const rateLimited = new HarnessAttempt(attemptOptions("ratelimit", root));
    const rateError = await rateLimited
      .start({ cwd: root, provider: "deepseek-official", model: "deepseek-chat" })
      .catch((caught: unknown) => caught);
    expect((rateError as NodeExecutionError).code).toBe("RATE_LIMITED");
    await rateLimited.dispose();

    const authFailed = new HarnessAttempt(attemptOptions("authfail", root));
    await authFailed.start({ cwd: root, provider: "deepseek-official", model: "deepseek-chat" });
    const authError = await authFailed.runTurn("session-1", "hello").catch((caught: unknown) => caught);
    expect((authError as NodeExecutionError).code).toBe("AUTH_FAILED");
    expect((authError as NodeExecutionError).retryable).toBe(false);
    await authFailed.dispose();
  });

  it("resumes a persisted session before prompting", async () => {
    const root = makeRoot();
    const attempt = new HarnessAttempt(attemptOptions("ok", root));
    await attempt.start({ cwd: root, provider: "deepseek-official", model: "deepseek-chat" });
    await expect(attempt.resume("persisted-session")).resolves.toBeUndefined();
    const outcome = await attempt.runTurn("persisted-session", "continue");
    expect(outcome.turnEndKind).toBe("completed");
    await attempt.shutdown();
  });

  it("captures the child stderr tail for diagnostics", async () => {
    const root = makeRoot();
    const attempt = new HarnessAttempt(attemptOptions("stderr-noise", root));
    await attempt.start({ cwd: root, provider: "deepseek-official", model: "deepseek-chat" });
    const outcome = await attempt.runTurn("session-1", "hello");
    expect(outcome.finalResponse).toBe("fake final response");
    expect(attempt.stderrTail.join("\n")).toContain("fake harness diagnostic line");
    await attempt.shutdown();
  });

  it("tolerates kill and dispose before start and repeated dispose", async () => {
    const root = makeRoot();
    const attempt = new HarnessAttempt(attemptOptions("ok", root));
    await expect(attempt.kill()).resolves.toBeUndefined();
    await expect(attempt.dispose()).resolves.toBeUndefined();
    await expect(attempt.dispose()).resolves.toBeUndefined();
    await expect(attempt.start({ cwd: root, provider: "p", model: "m" })).rejects.toThrow(
      "attempt is closed",
    );
  });
});
