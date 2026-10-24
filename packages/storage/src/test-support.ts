/**
 * Test helpers: temp data roots, a controllable clock and minimal valid
 * contract entities. Not a test file itself (excluded from the *.test.ts
 * glob) but exercised through the suites below.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  type Approval,
  type Artifact,
  type Bot,
  type EventEnvelope,
  type ModelProfile,
  type Run,
  type Schedule,
  type Workflow,
} from "@deepseek-bot/contracts";
import { createCredentialRef } from "./credentials.js";
import { ensureDataLayout, type DataLayout } from "./layout.js";
import { openDatabase, type OpenedDatabase } from "./database.js";

export function makeTempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "dsb-storage-"));
}

export function makeLayout(root: string): DataLayout {
  return ensureDataLayout(root);
}

export interface TestClock {
  readonly now: () => Date;
  advanceMs(ms: number): void;
  setIso(iso: string): void;
}

export function makeTestClock(startIso = "2026-10-24T00:00:00.000Z"): TestClock {
  let current = new Date(startIso).getTime();
  return {
    now: () => new Date(current),
    advanceMs(ms: number) {
      current += ms;
    },
    setIso(iso: string) {
      current = new Date(iso).getTime();
    },
  };
}

export function openTestDatabase(
  layout: DataLayout,
  clock: TestClock = makeTestClock(),
): OpenedDatabase {
  return openDatabase(layout.dbFile, { now: clock.now });
}

/** Model profile + registered credential + workspace, ready for bot creation. */
export function seedProfileAndWorkspace(
  db: OpenedDatabase,
  options: { profileId?: string; workspaceId?: string; credentialRef?: string } = {},
): { profile: ModelProfile; credentialRef: string; workspaceId: string } {
  const ref = options.credentialRef ?? createCredentialRef();
  const now = db.now().toISOString();
  db.raw
    .prepare(
      "INSERT INTO credentials (ref, label, created_at, updated_at) VALUES (?, 'test', ?, ?);",
    )
    .run(ref, now, now);
  const profile: ModelProfile = {
    id: options.profileId ?? randomUUID(),
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
    .run(
      profile.id,
      profile.model,
      profile.endpoint,
      profile.credentialRef,
      JSON.stringify(profile.limits),
      now,
      now,
    );
  const workspaceId = options.workspaceId ?? randomUUID();
  db.raw
    .prepare(
      "INSERT INTO workspaces (id, canonical_path, grants_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?);",
    )
    .run(workspaceId, "D:\\workspaces\\demo", "[]", now, now);
  return { profile, credentialRef: ref, workspaceId };
}

export function makeBot(
  profile: ModelProfile,
  workspaceId: string,
  overrides: Partial<Bot> = {},
): Bot {
  return {
    id: randomUUID(),
    revision: randomUUID(),
    name: "测试机器人",
    instructions: "仅用于存储测试的指令文本。",
    modelProfileId: profile.id,
    workspaceId,
    toolPolicyId: randomUUID(),
    archivedAt: null,
    ...overrides,
  };
}

export function makeWorkflow(overrides: Partial<Workflow> = {}): Workflow {
  return {
    id: randomUUID(),
    revision: randomUUID(),
    name: "存储测试工作流",
    schemaVersion: "0.1",
    nodes: [
      {
        id: "n1",
        type: "bot",
        botId: randomUUID(),
        instructionTemplate: "把输入原样回复。",
        inputBindings: [],
        retryPolicy: { maxRetries: 0 },
      },
    ],
    edges: [],
    limits: { maxConcurrentNodes: 2 },
    ...overrides,
  };
}

export function makeSchedule(workflowId: string, overrides: Partial<Schedule> = {}): Schedule {
  return {
    id: randomUUID(),
    workflowId,
    timezone: "Asia/Shanghai",
    recurrence: "0 9 * * 1-5",
    nextRunAt: null,
    enabled: true,
    misfirePolicy: "skip-and-notify",
    ...overrides,
  };
}

export function makeRun(workflow: Workflow, overrides: Partial<Run> = {}): Run {
  return {
    id: randomUUID(),
    workflowSnapshot: workflow,
    botSnapshots: [],
    status: "queued",
    trigger: { kind: "manual", idempotencyKey: randomUUID() },
    createdAt: new Date().toISOString(),
    finishedAt: null,
    ...overrides,
  };
}

export function makeApproval(runId: string, nodeRunId: string, overrides: Partial<Approval> = {}): Approval {
  return {
    id: randomUUID(),
    runId,
    nodeRunId,
    actionDigest: "a".repeat(64),
    resource: "D:\\workspaces\\demo\\out.txt",
    expiresAt: "2026-10-24T00:10:00.000Z",
    status: "pending",
    ...overrides,
  };
}

export function makeArtifact(runId: string, nodeRunId: string, overrides: Partial<Artifact> = {}): Artifact {
  return {
    id: randomUUID(),
    runId,
    nodeRunId,
    relativePath: "runs/demo/output.txt",
    mediaType: "text/plain",
    size: 12,
    checksum: { algorithm: "sha256", value: "b".repeat(64) },
    ...overrides,
  };
}

export function makeEvent(
  runId: string,
  sequence: number,
  overrides: Partial<EventEnvelope> = {},
): EventEnvelope {
  return {
    eventId: randomUUID(),
    runId,
    sequence,
    timestamp: new Date().toISOString(),
    type: "run.created",
    payload: { workflowId: randomUUID(), triggerKind: "manual" },
    ...overrides,
  };
}
