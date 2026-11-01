import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { NodeExecutionError } from "@deepseek-bot/runtime";
import type { Bot, ModelProfile } from "@deepseek-bot/contracts";
import { DshSdkExecutor, harnessSessionId } from "./dsh-executor.js";
import { PINNED_DSH_VERSION } from "./launch.js";

const fakeHarness = fileURLToPath(new URL("./testing/fake-harness.mjs", import.meta.url));

const roots: string[] = [];
afterAll(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "dsb-executor-"));
  roots.push(root);
  return root;
}

const profile: ModelProfile = {
  id: "profile-1",
  provider: "deepseek",
  model: "deepseek-chat",
  endpoint: "https://api.deepseek.com/v1",
  credentialRef: "cred:test",
  limits: { maxTokens: 4096 },
};

function bot(overrides: Partial<Bot> = {}): Bot {
  return {
    id: "bot-1",
    revision: "rev-1",
    name: "集成机器人",
    instructions: "始终使用简洁中文回复。",
    modelProfileId: profile.id,
    workspaceId: "workspace-1",
    toolPolicyId: "policy-1",
    role: "standard",
    archivedAt: null,
    ...overrides,
  };
}

interface RecordedFrame {
  readonly method?: string;
  readonly params?: Record<string, unknown>;
  readonly env?: { DSH_HOME?: string; DEEPSEEK_API_KEY?: string };
}

function readRecord(root: string): RecordedFrame[] {
  return readFileSync(join(root, "fake-harness.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as RecordedFrame);
}

interface ExecuteHarness {
  readonly root: string;
  readonly recordDir: string;
  readonly executor: DshSdkExecutor;
  readonly context: Parameters<DshSdkExecutor["executeBotNode"]>[0];
}

function makeExecutor(scenario: string, botOverrides: Partial<Bot> = {}): ExecuteHarness {
  const root = makeRoot();
  const recordDir = join(root, "record");
  const workspace = join(root, "workspace");
  mkdirSync(workspace, { recursive: true });
  const executor = new DshSdkExecutor({
    dshBin: fakeHarness,
    dshHome: join(root, "dsh-home"),
    childEnv: (parent) => ({ ...parent, FAKE_SCENARIO: scenario, FAKE_RECORD_DIR: recordDir }),
    resolveBotInputs: async () => ({
      profile,
      workspacePath: workspace,
      apiKey: "test-key-123",
    }),
  });
  const testBot = bot(botOverrides);
  const context = {
    run: { id: "run-1" },
    nodeRun: { id: "node-run-1", attempt: 1 },
    node: {
      id: "node-1",
      type: "bot",
      botId: testBot.id,
      instructionTemplate: "总结 {{input.topic}}。",
      inputBindings: [],
      retryPolicy: { maxRetries: 0 },
    },
    bot: testBot,
    inputs: { topic: "本地调度" },
    signal: new AbortController().signal,
    permissions: {
      evaluate: async () => {
        throw new Error("not used in this test");
      },
      authorize: async () => {
        throw new Error("not used in this test");
      },
    },
  } as unknown as Parameters<DshSdkExecutor["executeBotNode"]>[0];
  return { root, recordDir, executor, context };
}

describe("DshSdkExecutor", () => {
  it("does not resolve the pinned runtime while constructing", () => {
    const root = makeRoot();
    expect(
      () =>
        new DshSdkExecutor({
          dshHome: join(root, "dsh-home"),
          resolveBotInputs: async () => ({ profile, workspacePath: root, apiKey: "k" }),
        }),
    ).not.toThrow();
  });

  it("resolves the pinned runtime spec when no dshBin override is given", () => {
    const root = makeRoot();
    const executor = new DshSdkExecutor({
      dshHome: join(root, "dsh-home"),
      profile: "sdk",
      patches: [join(root, "telemetry.patch.yml")],
      provider: "deepseek-official",
      initializeTimeoutMs: 20_000,
      resolveBotInputs: async () => ({ profile, workspacePath: root, apiKey: "k" }),
    });
    expect(executor.launchSpec?.version).toBe(PINNED_DSH_VERSION);
    expect(executor.launchSpec?.dshBin.toLowerCase().endsWith("bin.js")).toBe(true);
    expect(executor.sessions.size).toBe(0);
  });

  it("runs one attempt on the pinned fake runtime and returns outputs and session id", async () => {
    const { executor, context } = makeExecutor("ok");
    const result = await executor.executeBotNode(context);
    expect(result.sessionId).toBe(harnessSessionId("node-run-1", 1));
    expect(result.outputs).toEqual({ response: "fake final response", turnEndKind: "completed" });
    expect(executor.sessions.size).toBe(0);
  });

  it("passes the resolved model route, workspace and credential to the runtime", async () => {
    const { root, recordDir, executor, context } = makeExecutor("echo-model");
    const result = await executor.executeBotNode(context);
    const frames = readRecord(recordDir);
    const initialize = frames.find((frame) => frame.method === "initialize");
    const envRecord = frames.find((frame) => frame.env !== undefined);
    const prompt = frames.find((frame) => frame.method === "session/prompt");
    expect(initialize?.params).toMatchObject({
      cwd: join(root, "workspace"),
      provider: "deepseek-official",
      model: "deepseek-chat",
      maxTokens: 4096,
    });
    expect(envRecord?.env).toEqual({
      DSH_HOME: join(root, "dsh-home"),
      DEEPSEEK_API_KEY: "test-key-123",
    });
    const promptText = (prompt?.params?.["contentBlocks"] as Array<{ text: string }>)[0]?.text;
    expect(promptText).toContain("始终使用简洁中文回复。");
    expect(promptText).toContain("总结 本地调度。");
    expect(result.outputs["response"]).toContain("model=deepseek-chat");
  });

  it("registers the session in the shared registry while running", async () => {
    const { executor, context } = makeExecutor("hang");
    const controller = new AbortController();
    const abortableContext = {
      ...context,
      signal: controller.signal,
    };
    const pending = executor.executeBotNode(abortableContext);
    const deadline = Date.now() + 5_000;
    while (executor.sessions.size === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const registered = executor.sessions.resolve(harnessSessionId("node-run-1", 1));
    expect(registered?.runId).toBe("run-1");
    expect(registered?.nodeRunId).toBe("node-run-1");
    expect(registered?.permissions).toBe(abortableContext.permissions);
    controller.abort();
    const error = await pending.catch((caught: unknown) => caught);
    expect((error as NodeExecutionError).code).toBe("CANCELLED");
    expect(executor.sessions.size).toBe(0);
  });

  it("fails without executing when the host cannot resolve runtime inputs", async () => {
    const root = makeRoot();
    const executor = new DshSdkExecutor({
      dshBin: fakeHarness,
      dshHome: join(root, "dsh-home"),
      resolveBotInputs: async () => {
        throw new Error("workspace record missing");
      },
    });
    const { context } = makeExecutor("ok");
    const error = await executor.executeBotNode(context).catch((caught: unknown) => caught);
    expect((error as NodeExecutionError).code).toBe("INVALID_INPUT");
    expect((error as NodeExecutionError).retryable).toBe(false);
  });

  it("surfaces unknown template inputs as INVALID_INPUT", async () => {
    const { executor, context } = makeExecutor("ok");
    const brokenContext = {
      ...context,
      node: {
        ...context.node,
        instructionTemplate: "引用 {{input.absent_key}}。",
      },
      inputs: {},
    };
    const error = await executor.executeBotNode(brokenContext).catch((caught: unknown) => caught);
    expect((error as NodeExecutionError).code).toBe("INVALID_INPUT");
  });
});
