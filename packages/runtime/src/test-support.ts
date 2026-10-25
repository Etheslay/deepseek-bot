/**
 * Test helpers: temp databases, fixture entities and fake executors.
 * Not a test file itself (excluded from the *.test.ts glob) but exercised
 * through the suites below. Mirrors the storage package's approach because
 * storage does not export its own helpers.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  type Bot,
  type ModelProfile,
  type Workflow,
} from "@deepseek-bot/contracts";
import { openDatabase, type OpenedDatabase } from "@deepseek-bot/storage";
import {
  NodeExecutionError,
  type BotNodeExecutionContext,
  type BotNodeExecutionResult,
  type NodeExecutor,
} from "./executor.js";

export function makeTempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "dsb-runtime-"));
}

export function openTestDatabase(): OpenedDatabase {
  // node:sqlite requires an existing directory with a real file path.
  const root = makeTempRoot();
  return openDatabase(path.join(root, "app.sqlite"));
}

export interface SeededRefs {
  readonly profile: ModelProfile;
  readonly workspaceId: string;
  /** Default least-privilege tool policy created for the seeded bot. */
  readonly toolPolicyId: string;
}

/** Insert the credential/profile/workspace/tool-policy rows a bot needs. */
export function seedProfileAndWorkspace(db: OpenedDatabase): SeededRefs {
  const ref = `cred:${randomUUID()}`;
  const now = db.now().toISOString();
  db.raw
    .prepare(
      "INSERT INTO credentials (ref, label, created_at, updated_at) VALUES (?, 'test', ?, ?);",
    )
    .run(ref, now, now);
  const profile: ModelProfile = {
    id: randomUUID(),
    provider: "deepseek",
    model: "deepseek-chat",
    endpoint: "https://api.deepseek.com/v1",
    credentialRef: ref,
    limits: { maxTokens: 8192 },
  };
  db.raw
    .prepare(
      "INSERT INTO model_profiles (id, provider, model, endpoint, credential_ref, limits_json, created_at, updated_at) " +
        "VALUES (?, 'deepseek', ?, ?, ?, ?, ?, ?);",
    )
    .run(profile.id, profile.model, profile.endpoint, profile.credentialRef, "{}", now, now);
  const workspaceId = randomUUID();
  db.raw
    .prepare(
      "INSERT INTO workspaces (id, canonical_path, grants_json, created_at, updated_at) VALUES (?, ?, '[]', ?, ?);",
    )
    .run(workspaceId, "D:\\workspaces\\demo", now, now);
  const toolPolicyId = randomUUID();
  db.raw
    .prepare(
      "INSERT INTO tool_policies (id, revision, name, policy_json, created_at, updated_at) " +
        "VALUES (?, ?, ?, ?, ?, ?);",
    )
    .run(
      toolPolicyId,
      randomUUID(),
      "测试工具策略",
      JSON.stringify({
        filesystem: { enabled: false, operations: [] },
        shell: { mode: "disabled" },
        network: { mode: "disabled" },
        mcp: { enabled: false, requireApproval: false, servers: [] },
      }),
      now,
      now,
    );
  return { profile, workspaceId, toolPolicyId };
}

export function makeBot(refs: SeededRefs, overrides: Partial<Bot> = {}): Bot {
  return {
    id: randomUUID(),
    revision: randomUUID(),
    name: "引擎测试机器人",
    instructions: "仅用于运行时测试的指令文本。",
    modelProfileId: refs.profile.id,
    workspaceId: refs.workspaceId,
    toolPolicyId: refs.toolPolicyId,
    archivedAt: null,
    ...overrides,
  };
}

export function insertBot(db: OpenedDatabase, bot: Bot): void {
  const now = db.now().toISOString();
  db.raw
    .prepare(
      "INSERT INTO bots (id, revision, name, instructions, model_profile_id, workspace_id, " +
        "tool_policy_id, archived_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);",
    )
    .run(
      bot.id,
      bot.revision,
      bot.name,
      bot.instructions,
      bot.modelProfileId,
      bot.workspaceId,
      bot.toolPolicyId,
      bot.archivedAt,
      now,
      now,
    );
}

export function insertWorkflow(db: OpenedDatabase, workflow: Workflow): void {
  const now = db.now().toISOString();
  db.raw
    .prepare(
      "INSERT INTO workflows (id, revision, name, schema_version, nodes_json, edges_json, " +
        "limits_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);",
    )
    .run(
      workflow.id,
      workflow.revision,
      workflow.name,
      workflow.schemaVersion,
      JSON.stringify(workflow.nodes),
      JSON.stringify(workflow.edges),
      JSON.stringify(workflow.limits),
      now,
      now,
    );
}

export function botNode(
  nodeId: string,
  botId: string,
  overrides: Partial<Workflow["nodes"][number]> = {},
): Workflow["nodes"][number] {
  return {
    id: nodeId,
    type: "bot",
    botId,
    instructionTemplate: `node ${nodeId} instruction`,
    inputBindings: [],
    retryPolicy: { maxRetries: 0 },
    ...overrides,
  };
}

export function approvalNode(
  nodeId: string,
  overrides: Partial<Workflow["nodes"][number]> = {},
): Workflow["nodes"][number] {
  return {
    id: nodeId,
    type: "approval",
    instructionTemplate: `approval gate ${nodeId}`,
    inputBindings: [],
    retryPolicy: { maxRetries: 0 },
    ...overrides,
  };
}

export function makeWorkflowFixture(
  nodes: Workflow["nodes"],
  edges: Workflow["edges"],
  limits: Workflow["limits"] = { maxConcurrentNodes: 2 },
): Workflow {
  return {
    id: randomUUID(),
    revision: randomUUID(),
    name: "运行时测试工作流",
    schemaVersion: "0.1",
    nodes,
    edges,
    limits,
  };
}

export function makeEdge(
  from: string,
  outputKey: string,
  to: string,
  inputKey: string,
): Workflow["edges"][number] {
  return { fromNodeId: from, outputKey, toNodeId: to, inputKey };
}

// ---------------------------------------------------------------------------
// Fake executors
// ---------------------------------------------------------------------------

/** Manually resolved promise for driving scheduler timing in tests. */
export class Deferred<T> {
  readonly promise: Promise<T>;
  resolve!: (value: T) => void;
  reject!: (error: unknown) => void;

  constructor() {
    this.promise = new Promise<T>((res, rej) => {
      this.resolve = res;
      this.reject = rej;
    });
  }
}

export interface RecordedCall {
  readonly nodeId: string;
  readonly attempt: number;
  readonly inputs: Readonly<Record<string, unknown>>;
  readonly instruction: string;
}

/**
 * Scripted executor: each call pops the next behavior; unscripted calls
 * resolve immediately with empty outputs.
 */
export class ScriptedExecutor implements NodeExecutor {
  readonly calls: RecordedCall[] = [];
  private readonly behaviors: Array<
    (context: BotNodeExecutionContext) => Promise<BotNodeExecutionResult>
  > = [];

  enqueue(behavior: (context: BotNodeExecutionContext) => Promise<BotNodeExecutionResult>): this {
    this.behaviors.push(behavior);
    return this;
  }

  /** Resolve with the given outputs; also records the call. */
  resolve(outputs: Record<string, unknown> = {}): this {
    return this.enqueue(async () => ({ outputs }));
  }

  /** Reject with a classified error. */
  reject(error: NodeExecutionError): this {
    return this.enqueue(async () => {
      throw error;
    });
  }

  async executeBotNode(context: BotNodeExecutionContext): Promise<BotNodeExecutionResult> {
    this.calls.push({
      nodeId: context.node.id,
      attempt: context.nodeRun.attempt,
      inputs: context.inputs,
      instruction: context.node.instructionTemplate,
    });
    const behavior = this.behaviors.shift();
    if (behavior === undefined) {
      return { outputs: {} };
    }
    return behavior(context);
  }
}

/** Executor that never settles; used for timeout and grace tests. */
export class HangingExecutor implements NodeExecutor {
  readonly abortObserved: Promise<void>;
  private signalReceived: (() => void) | null = null;

  constructor(respectAbort = false) {
    this.abortObserved = new Promise<void>((resolve) => {
      this.signalReceived = respectAbort ? resolve : null;
      if (!respectAbort) {
        resolve();
      }
    });
  }

  executeBotNode(context: BotNodeExecutionContext): Promise<BotNodeExecutionResult> {
    if (this.signalReceived !== null) {
      context.signal.addEventListener("abort", () => this.signalReceived?.(), { once: true });
    }
    return new Promise<BotNodeExecutionResult>(() => {});
  }
}

/** Executor that hangs until its abort signal fires, then keeps hanging. */
export class AbortHangingExecutor implements NodeExecutor {
  readonly abortSignal: Promise<void>;
  private readonly waiters: Array<() => void> = [];

  constructor() {
    this.abortSignal = new Promise<void>((resolve) => {
      this.waiters.push(resolve);
    });
  }

  executeBotNode(context: BotNodeExecutionContext): Promise<BotNodeExecutionResult> {
    context.signal.addEventListener("abort", () => {
      for (const waiter of this.waiters) {
        waiter();
      }
    }, { once: true });
    return new Promise(() => {});
  }
}

/** Wait until `predicate()` is true or the timeout elapses. */
export async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error("waitFor timed out");
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
}
