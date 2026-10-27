/**
 * RunService (D09 brief §2.1): monitor/approval-facing API for the run.*,
 * events.subscribe and approval.decide method contracts. The fixture
 * implementation is deterministic scripted playback (夹具回放) over in-memory
 * session state — the real engine (D06), backend approval interception
 * (D08), persistence (D04) and scheduling (D10) are NOT wired here and must
 * not be implied as done.
 *
 * Scenario events reuse the D03 contract fixtures verbatim where they exist
 * (success-run / cancel-run / approval-denied / approval-expired /
 * crash-reconnect). Fixture slices that originally share one run are seeded
 * into separate example runs: runId/nodeRunId values are remapped to
 * synthetic ids from the shared pool shape, every envelope re-validated
 * against EventEnvelopeSchema + its payload schema, and scenario scripts
 * only move runs through transitions the contracts state machines allow.
 */
import {
  APPROVAL_DEFAULT_TTL_MS,
  AssistantDeltaSchema,
  EventEnvelopeSchema,
  NodeRunSchema,
  RunSchema,
  assertNodeRunTransition,
  assertRunTransition,
  canTransitionRun,
  isRunTerminal,
  parseEventPayload,
  type Approval,
  type Artifact,
  type AssistantDelta,
  type EventEnvelope,
  type EventType,
  type NodeRun,
  type Run,
  type RunStatus,
} from "@deepseek-bot/contracts";
import { ServiceError } from "../../services/desktop-service.js";
import type { ApprovalBaseline } from "./events/run-view.js";
import { t } from "../../i18n.js";

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

export type RunListQuery = {
  status?: RunStatus;
  limit?: number;
};

export type DecideApprovalInput = {
  approvalId: string;
  decision: "approved" | "denied";
  expectedActionDigest: string;
};

export type SubscribeResult = {
  events: EventEnvelope[];
  snapshotRequired: boolean;
};

export interface RunServiceApi {
  /** run.list: newest first, optional status filter, single fixture page. */
  list(query?: RunListQuery): Promise<{ runs: Run[]; nextCursor: string | null }>;
  /** run.get. */
  get(runId: string): Promise<Run>;
  /** Approval inbox across runs (UI view composed from run state). */
  listApprovals(): Promise<ApprovalBaseline[]>;
  /** Snapshot baseline for view rebuilds (UI view, like chat.listSessions). */
  snapshot(runId: string): Promise<{
    run: Run;
    nodeRuns: NodeRun[];
    approvals: ApprovalBaseline[];
    artifacts: Artifact[];
  }>;
  /** events.subscribe: runId + afterSequence; retention gaps → snapshotRequired. */
  subscribe(runId: string, afterSequence: number): Promise<SubscribeResult>;
  /** run.cancel: cancelling → cancelled; idempotent on terminal runs. */
  cancel(runId: string): Promise<Run>;
  /**
   * run.retryNode with the engine's rules: active run only, latest failed
   * attempt only, no progressed descendants (CONTRACTS §3).
   */
  retryNode(nodeRunId: string): Promise<NodeRun>;
  /**
   * approval.decide: validates digest, pending status, validity window and
   * host generation; a decided approval can never be decided again.
   */
  decideApproval(input: DecideApprovalInput): Promise<Approval>;
  /** Drain queued transient assistant.delta chunks (瞬态流，不占 sequence). */
  pullTransient(runId: string): Promise<AssistantDelta[]>;
  /**
   * Fixture-only scripted playback (夹具回放): append the next batch of
   * contract-valid events. Throws when the script is exhausted.
   */
  advanceScenario(runId: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const RUN_SUCCESS = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const RUN_ACTIVE = "dddddddd-dddd-4ddd-8ddd-dddddddddd0a";
const RUN_APPROVAL = "dddddddd-dddd-4ddd-8ddd-dddddddddd0b";
const RUN_EXPIRED = "dddddddd-dddd-4ddd-8ddd-dddddddddd0c";
const RUN_STALE = "dddddddd-dddd-4ddd-8ddd-dddddddddd0d";
const RUN_INTERRUPTED = "dddddddd-dddd-4ddd-8ddd-dddddddddd0e";
const RUN_RESUMED = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const RUN_RETRY = "dddddddd-dddd-4ddd-8ddd-dddddddddd0f";

/** Scenario ids + the node runs tests address (shared-pool-shaped synthetics). */
export const FIXTURE_RUNS = {
  success: RUN_SUCCESS,
  active: RUN_ACTIVE,
  approval: RUN_APPROVAL,
  expired: RUN_EXPIRED,
  stale: RUN_STALE,
  interrupted: RUN_INTERRUPTED,
  resumed: RUN_RESUMED,
  retry: RUN_RETRY,
} as const;

export const FIXTURE_NODE_RUNS = {
  activeN1: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee0a",
  approvalDraft: "eeeeeeee-eeee-4eee-8eee-eeeeeeeee0b1",
  approvalGate: "eeeeeeee-eeee-4eee-8eee-eeeeeeeee0b2",
  retryR1: "e2e2e2e2-e2e2-4e2e-8e2e-e2e2e2e2e201",
  retryR2: "e2e2e2e2-e2e2-4e2e-8e2e-e2e2e2e2e202",
} as const;

const WORKFLOW_DAILY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const WORKFLOW_DAILY_REV = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const WORKFLOW_REVIEW = "abababab-abab-4aba-8aba-ababababab01";
const WORKFLOW_REVIEW_REV = "bcbcbcbc-bcbc-4bcb-8bcb-bcbcbcbcbc01";
const WORKFLOW_RETRY = "abababab-abab-4aba-8aba-ababababab02";
const WORKFLOW_RETRY_REV = "bcbcbcbc-bcbc-4bcb-8bcb-bcbcbcbcbc02";

const BOT_A = "11111111-1111-4111-8111-111111111111";
const BOT_B = "12121212-1212-4121-8121-121212121212";
const MODEL_PROFILE = "44444444-4444-4444-8444-444444444444";
const WORKSPACE = "55555555-5555-4555-8555-555555555555";
const TOOL_POLICY = "66666666-6666-4666-8666-666666666666";

const APPROVAL_LIVE = "12341234-1234-4123-8123-123412341234";
const APPROVAL_EXPIRED = "12341234-1234-4123-8123-12341234123c";
const APPROVAL_STALE = "12341234-1234-4123-8123-12341234123d";

export const FIXTURE_APPROVALS = {
  live: APPROVAL_LIVE,
  expired: APPROVAL_EXPIRED,
  stale: APPROVAL_STALE,
} as const;

const ACTION_DIGEST =
  "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";
const APPROVAL_RESOURCE = "D:\\workspaces\\demo\\report.md";
const EXPIRED_AT_PAST = "2026-10-24T10:10:00Z";

/** Approvals are bound to the host generation that created them (§2). */
const HOST_GENERATION = 1;

function isoNow(): string {
  return new Date().toISOString();
}

/** INVALID_INPUT factory; call sites `throw` so control flow stays obvious. */
function invalidInput(message: string): ServiceError {
  return new ServiceError("INVALID_INPUT", message);
}

let syntheticEventCounter = 0x9000;

function nextEventId(): string {
  syntheticEventCounter += 1;
  return `20000000-0000-4000-8000-${syntheticEventCounter.toString(16).padStart(12, "0")}`;
}

type ScenarioStep = () => void;

type ScenarioRun = {
  run: Run;
  events: EventEnvelope[];
  transient: AssistantDelta[];
  /** Lowest sequence the fixture can still replay (retention floor). */
  retentionFloor: number;
  closed: boolean;
  /** RUN_SUCCESS replies duplicate one envelope (at-least-once demo). */
  injectDuplicate: boolean;
  script: ScenarioStep[];
  scriptIndex: number;
  /** Once cancelling, this step drains the graph to `cancelled`. */
  cancelFinish: ScenarioStep | null;
};

type ApprovalRecord = {
  approval: Approval;
  generation: number;
  requestedAt: string;
  resolved?: { decision: "approved" | "denied" | "expired"; resolvedAt: string };
};

function workflowSnapshot(
  id: string,
  revision: string,
  name: string,
  nodes: {
    id: string;
    type: "bot" | "approval";
    botId?: string;
    instructionTemplate: string;
  }[],
  edges: { from: string; to: string; key?: string }[],
): Run["workflowSnapshot"] {
  return {
    id,
    revision,
    name,
    schemaVersion: "0.1",
    nodes: nodes.map((node) => ({
      id: node.id,
      type: node.type,
      ...(node.botId !== undefined ? { botId: node.botId } : {}),
      instructionTemplate: node.instructionTemplate,
      inputBindings: [],
      retryPolicy: { maxRetries: 0 },
    })),
    edges: edges.map((edge) => ({
      fromNodeId: edge.from,
      outputKey: edge.key ?? "output",
      toNodeId: edge.to,
      inputKey: edge.key ?? "output",
    })),
    limits: { maxConcurrentNodes: 2 },
  };
}

function botSnapshot(
  id: string,
  revision: string,
  name: string,
  instructions: string,
): Run["botSnapshots"][number] {
  return {
    id,
    revision,
    name,
    instructions,
    modelProfileId: MODEL_PROFILE,
    workspaceId: WORKSPACE,
    toolPolicyId: TOOL_POLICY,
    role: "standard",
    archivedAt: null,
  };
}

function seedRun(
  partial: Pick<Run, "id" | "workflowSnapshot" | "botSnapshots" | "status" | "trigger" | "createdAt"> & {
    finishedAt?: string | null;
    resumedFromRunId?: string;
  },
): Run {
  const run: Run = RunSchema.parse({
    ...partial,
    finishedAt: partial.finishedAt ?? null,
    ...(partial.resumedFromRunId !== undefined
      ? { resumedFromRunId: partial.resumedFromRunId }
      : {}),
  });
  return run;
}

function seedNodeRun(
  id: string,
  runId: string,
  nodeId: string,
  attempt: number,
  status: NodeRun["status"],
  sessionId: string | null,
): NodeRun {
  return NodeRunSchema.parse({
    id,
    runId,
    nodeId,
    attempt,
    status,
    inputRefs: [],
    outputRefs: [],
    sessionId,
  });
}

// ---------------------------------------------------------------------------
// Fixture service
// ---------------------------------------------------------------------------

export function createFixtureRunService(): RunServiceApi {
  const scenarios = new Map<string, ScenarioRun>();
  const nodeRunIndex = new Map<string, { runId: string; nodeId: string }>();
  const approvals = new Map<string, ApprovalRecord>();
  const nodeRunsByRun = new Map<string, NodeRun[]>();
  const artifactsByRun = new Map<string, Artifact[]>();

  const requireScenario = (runId: string): ScenarioRun => {
    const scenario = scenarios.get(runId);
    if (!scenario) {
      throw new ServiceError("INVALID_INPUT", `run not found: ${runId}`);
    }
    return scenario;
  };

  /** Append a contract-valid envelope; payload schemas must accept it. */
  const appendEvent = (
    scenario: ScenarioRun,
    timestamp: string,
    type: EventType,
    payload: unknown,
  ): void => {
    const candidate = {
      eventId: nextEventId(),
      runId: scenario.run.id,
      sequence: scenario.events.length
        ? scenario.events[scenario.events.length - 1]!.sequence + 1
        : 0,
      timestamp,
      type,
      payload,
    };
    const envelope = EventEnvelopeSchema.parse(candidate);
    const payloadCheck = parseEventPayload(envelope);
    if (!payloadCheck.success) {
      throw new Error(
        `fixture produced an invalid ${type} payload: ${payloadCheck.error.issues[0]?.message ?? ""}`,
      );
    }
    scenario.events.push(envelope);
  };

  const moveRun = (scenario: ScenarioRun, to: RunStatus, reason?: string): void => {
    const from = scenario.run.status;
    assertRunTransition(from, to);
    scenario.run = { ...scenario.run, status: to };
    appendEvent(scenario, isoNow(), "run.statusChanged", {
      from,
      to,
      ...(reason !== undefined ? { reason } : {}),
    });
  };

  const nodeRunStatus = (scenario: ScenarioRun, nodeRunId: string): NodeRun["status"] => {
    const list = nodeRunsByRun.get(scenario.run.id) ?? [];
    const found = list.find((entry) => entry.id === nodeRunId);
    if (!found) {
      throw new ServiceError("INVALID_INPUT", `node run not found: ${nodeRunId}`);
    }
    return found.status;
  };

  const moveNodeRun = (
    scenario: ScenarioRun,
    nodeRunId: string,
    nodeId: string,
    attempt: number,
    to: NodeRun["status"],
    reason?: string,
  ): void => {
    const list = nodeRunsByRun.get(scenario.run.id) ?? [];
    const from = nodeRunStatus(scenario, nodeRunId);
    assertNodeRunTransition(from, to);
    const updated = list.map((entry) =>
      entry.id === nodeRunId ? { ...entry, status: to } : entry,
    );
    nodeRunsByRun.set(scenario.run.id, updated);
    appendEvent(scenario, isoNow(), "node.statusChanged", {
      nodeRunId,
      nodeId,
      attempt,
      from,
      to,
      ...(reason !== undefined ? { reason } : {}) ,
    });
  };

  const queueTransient = (
    scenario: ScenarioRun,
    streamId: string,
    chunks: string[],
  ): void => {
    for (const [index, textDelta] of chunks.entries()) {
      scenario.transient.push(
        AssistantDeltaSchema.parse({ streamId, chunkIndex: index, textDelta }),
      );
    }
  };

  const registerScenario = (
    run: Run,
    options: {
      retentionFloor?: number;
      injectDuplicate?: boolean;
      script?: ScenarioStep[];
    } = {},
  ): ScenarioRun => {
    const scenario: ScenarioRun = {
      run,
      events: [],
      transient: [],
      retentionFloor: options.retentionFloor ?? 0,
      closed: isRunTerminal(run.status),
      injectDuplicate: options.injectDuplicate ?? false,
      script: options.script ?? [],
      scriptIndex: 0,
      cancelFinish: null,
    };
    scenarios.set(run.id, scenario);
    return scenario;
  };

  const registerNodeRuns = (runId: string, runs: NodeRun[]): void => {
    nodeRunsByRun.set(runId, runs);
    for (const nodeRun of runs) {
      nodeRunIndex.set(nodeRun.id, { runId, nodeId: nodeRun.nodeId });
    }
  };

  // -------------------------------------------------------------------------
  // Scenario seeds
  // -------------------------------------------------------------------------

  const dailyNoteWorkflow = workflowSnapshot(
    WORKFLOW_DAILY,
    WORKFLOW_DAILY_REV,
    "daily-note",
    [
      {
        id: "n1",
        type: "bot",
        botId: BOT_A,
        instructionTemplate: "Summarize the provided note in one paragraph.",
      },
    ],
    [],
  );
  const noteBot = botSnapshot(
    BOT_A,
    "22222222-2222-4222-8222-222222222222",
    "note-summarizer",
    "You summarize notes.",
  );
  const researchBot = botSnapshot(
    BOT_B,
    "3a3a3a3a-3a3a-43a3-83a3-3a3a3a3a3a3a",
    "research-bot",
    "You research the provided sample directory.",
  );

  // --- RUN_SUCCESS: success-run.json verbatim + one artifact.created ------
  {
    const run = seedRun({
      id: RUN_SUCCESS,
      workflowSnapshot: dailyNoteWorkflow,
      botSnapshots: [noteBot],
      status: "succeeded",
      trigger: { kind: "manual", idempotencyKey: "10000000-0000-4000-8000-000000000002" },
      createdAt: "2026-10-24T10:00:00Z",
      finishedAt: "2026-10-24T10:00:10Z",
    });
    const scenario = registerScenario(run, { injectDuplicate: true });
    const nodeRun = seedNodeRun(
      "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      RUN_SUCCESS,
      "n1",
      1,
      "succeeded",
      "sess-success-run",
    );
    registerNodeRuns(RUN_SUCCESS, [nodeRun]);
    const artifact: Artifact = {
      id: "23452345-2345-4234-8234-234523452345",
      runId: RUN_SUCCESS,
      nodeRunId: nodeRun.id,
      relativePath: "summaries/note-summary.md",
      mediaType: "text/markdown",
      size: 2048,
      checksum: { algorithm: "sha256", value: "a".repeat(64) },
    };
    artifactsByRun.set(RUN_SUCCESS, [artifact]);
    // success-run.json events 0-5 (verbatim), plus artifact.created (seq 6).
    const fixtureEvents: [number, string, EventType, unknown][] = [
      [0, "2026-10-24T10:00:00Z", "run.created", { workflowId: WORKFLOW_DAILY, triggerKind: "manual" }],
      [1, "2026-10-24T10:00:01Z", "run.statusChanged", { from: "queued", to: "running" }],
      [2, "2026-10-24T10:00:02Z", "node.statusChanged", { nodeRunId: nodeRun.id, nodeId: "n1", attempt: 1, from: "pending", to: "running" }],
      [3, "2026-10-24T10:00:10Z", "node.statusChanged", { nodeRunId: nodeRun.id, nodeId: "n1", attempt: 1, from: "running", to: "succeeded", reason: "node completed" }],
      [4, "2026-10-24T10:00:10Z", "run.statusChanged", { from: "running", to: "succeeded", reason: "all nodes finished" }],
      [5, "2026-10-24T10:00:10Z", "run.completed", { finishedAt: "2026-10-24T10:00:10Z" }],
      [6, "2026-10-24T10:00:10Z", "artifact.created", { artifact }],
    ];
    for (const [sequence, timestamp, type, payload] of fixtureEvents) {
      const envelope = EventEnvelopeSchema.parse({
        eventId: `20000000-0000-4000-8000-00000000000${sequence + 1}`,
        runId: RUN_SUCCESS,
        sequence,
        timestamp,
        type,
        payload,
      });
      scenario.events.push(envelope);
    }
  }

  // --- RUN_ACTIVE: cancel demo (cancelling → cancelled, events stop) ------
  {
    const run = seedRun({
      id: RUN_ACTIVE,
      workflowSnapshot: dailyNoteWorkflow,
      botSnapshots: [noteBot],
      status: "running",
      trigger: { kind: "manual", idempotencyKey: "10000000-0000-4000-8000-000000000003" },
      createdAt: "2026-10-24T10:30:00Z",
    });
    const nodeRun = seedNodeRun(
      "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee0a",
      RUN_ACTIVE,
      "n1",
      1,
      "running",
      "sess-active-run",
    );
    registerNodeRuns(RUN_ACTIVE, [nodeRun]);
    const scenario = registerScenario(run, {
      script: [
        // s1: a tool call plus transient streaming output.
        () => {
          appendEvent(scenario, isoNow(), "tool.requested", {
            nodeRunId: nodeRun.id,
            callId: "call-1",
            toolName: "read_workspace_file",
            arguments: { path: "workspaces/demo/note.md" },
            resource: "workspaces/demo/note.md",
          });
          queueTransient(scenario, "stream-active", [t("runs.deltaReadingWorkspace"), t("runs.deltaOrganizingPoints"), t("runs.deltaGeneratingSummary")]);
        },
        // s2: more transient output only (no persistent sequence).
        () => {
          queueTransient(scenario, "stream-active", [t("runs.deltaAddingConclusions"), t("runs.deltaProofreadingFormat"), t("runs.deltaWrappingUp")]);
        },
      ],
    });
    scenario.events.push(
      EventEnvelopeSchema.parse({
        eventId: "20000000-0000-4000-8000-000000000021",
        runId: RUN_ACTIVE,
        sequence: 0,
        timestamp: "2026-10-24T10:30:00Z",
        type: "run.created",
        payload: { workflowId: WORKFLOW_DAILY, triggerKind: "manual" },
      }),
      EventEnvelopeSchema.parse({
        eventId: "20000000-0000-4000-8000-000000000022",
        runId: RUN_ACTIVE,
        sequence: 1,
        timestamp: "2026-10-24T10:30:01Z",
        type: "run.statusChanged",
        payload: { from: "queued", to: "running" },
      }),
      EventEnvelopeSchema.parse({
        eventId: "20000000-0000-4000-8000-000000000023",
        runId: RUN_ACTIVE,
        sequence: 2,
        timestamp: "2026-10-24T10:30:02Z",
        type: "node.statusChanged",
        payload: { nodeRunId: nodeRun.id, nodeId: "n1", attempt: 1, from: "pending", to: "running" },
      }),
    );
  }

  // --- RUN_APPROVAL: waiting_approval, live 10-minute approval -----------
  {
    const workflow = workflowSnapshot(
      WORKFLOW_REVIEW,
      WORKFLOW_REVIEW_REV,
      "sample-review-flow",
      [
        { id: "draft-bot", type: "bot", botId: BOT_A, instructionTemplate: "Summarize the draft and emit a review." },
        { id: "human-approve", type: "approval", instructionTemplate: "Approve the summary before delivery." },
      ],
      [{ from: "draft-bot", to: "human-approve", key: "summary" }],
    );
    const run = seedRun({
      id: RUN_APPROVAL,
      workflowSnapshot: workflow,
      botSnapshots: [noteBot],
      status: "waiting_approval",
      trigger: { kind: "manual", idempotencyKey: "10000000-0000-4000-8000-000000000004" },
      createdAt: "2026-10-24T10:05:00Z",
    });
    const draftRun = seedNodeRun("eeeeeeee-eeee-4eee-8eee-eeeeeeeee0b1", RUN_APPROVAL, "draft-bot", 1, "succeeded", "sess-approval-draft");
    const approveRun = seedNodeRun("eeeeeeee-eeee-4eee-8eee-eeeeeeeee0b2", RUN_APPROVAL, "human-approve", 1, "waiting_approval", null);
    registerNodeRuns(RUN_APPROVAL, [draftRun, approveRun]);
    const scenario = registerScenario(run);
    const expiresAt = new Date(Date.now() + APPROVAL_DEFAULT_TTL_MS).toISOString();
    const approval: Approval = {
      id: APPROVAL_LIVE,
      runId: RUN_APPROVAL,
      nodeRunId: approveRun.id,
      actionDigest: ACTION_DIGEST,
      resource: APPROVAL_RESOURCE,
      expiresAt,
      status: "pending",
    };
    approvals.set(APPROVAL_LIVE, {
      approval,
      generation: HOST_GENERATION,
      requestedAt: isoNow(),
    });
    const setup: [string, EventType, unknown][] = [
      ["2026-10-24T10:05:00Z", "run.created", { workflowId: WORKFLOW_REVIEW, triggerKind: "manual" }],
      ["2026-10-24T10:05:01Z", "run.statusChanged", { from: "queued", to: "running" }],
      ["2026-10-24T10:05:02Z", "node.statusChanged", { nodeRunId: draftRun.id, nodeId: "draft-bot", attempt: 1, from: "pending", to: "running" }],
      ["2026-10-24T10:05:10Z", "node.statusChanged", { nodeRunId: draftRun.id, nodeId: "draft-bot", attempt: 1, from: "running", to: "succeeded", reason: "node completed" }],
      ["2026-10-24T10:05:11Z", "node.statusChanged", { nodeRunId: approveRun.id, nodeId: "human-approve", attempt: 1, from: "pending", to: "running" }],
      ["2026-10-24T10:05:11Z", "node.statusChanged", { nodeRunId: approveRun.id, nodeId: "human-approve", attempt: 1, from: "running", to: "waiting_approval" }],
      ["2026-10-24T10:05:11Z", "run.statusChanged", { from: "running", to: "waiting_approval" }],
      ["2026-10-24T10:05:12Z", "approval.requested", { approval }],
    ];
    for (const [timestamp, type, payload] of setup) {
      appendEvent(scenario, timestamp, type, payload);
    }
  }

  // --- RUN_EXPIRED: approval whose window has lapsed ----------------------
  {
    const run = seedRun({
      id: RUN_EXPIRED,
      workflowSnapshot: workflowSnapshot(
        WORKFLOW_REVIEW,
        WORKFLOW_REVIEW_REV,
        "sample-review-flow",
        [
          { id: "draft-bot", type: "bot", botId: BOT_A, instructionTemplate: "Summarize the draft and emit a review." },
          { id: "human-approve", type: "approval", instructionTemplate: "Approve the summary before delivery." },
        ],
        [{ from: "draft-bot", to: "human-approve", key: "summary" }],
      ),
      botSnapshots: [noteBot],
      status: "waiting_approval",
      trigger: { kind: "manual", idempotencyKey: "10000000-0000-4000-8000-000000000005" },
      createdAt: "2026-10-24T09:50:00Z",
    });
    const draftRun = seedNodeRun("eeeeeeee-eeee-4eee-8eee-eeeeeeeee0c1", RUN_EXPIRED, "draft-bot", 1, "succeeded", null);
    const approveRun = seedNodeRun("eeeeeeee-eeee-4eee-8eee-eeeeeeeee0c2", RUN_EXPIRED, "human-approve", 1, "waiting_approval", null);
    registerNodeRuns(RUN_EXPIRED, [draftRun, approveRun]);
    const scenario = registerScenario(run);
    const approval: Approval = {
      id: APPROVAL_EXPIRED,
      runId: RUN_EXPIRED,
      nodeRunId: approveRun.id,
      actionDigest: ACTION_DIGEST,
      resource: APPROVAL_RESOURCE,
      expiresAt: EXPIRED_AT_PAST,
      status: "pending",
    };
    approvals.set(APPROVAL_EXPIRED, {
      approval,
      generation: HOST_GENERATION,
      requestedAt: "2026-10-24T10:00:00Z",
    });
    const setup: [string, EventType, unknown][] = [
      ["2026-10-24T09:50:00Z", "run.created", { workflowId: WORKFLOW_REVIEW, triggerKind: "manual" }],
      ["2026-10-24T09:50:01Z", "run.statusChanged", { from: "queued", to: "running" }],
      ["2026-10-24T09:50:02Z", "node.statusChanged", { nodeRunId: draftRun.id, nodeId: "draft-bot", attempt: 1, from: "pending", to: "running" }],
      ["2026-10-24T09:50:10Z", "node.statusChanged", { nodeRunId: draftRun.id, nodeId: "draft-bot", attempt: 1, from: "running", to: "succeeded", reason: "node completed" }],
      ["2026-10-24T09:50:11Z", "node.statusChanged", { nodeRunId: approveRun.id, nodeId: "human-approve", attempt: 1, from: "pending", to: "running" }],
      ["2026-10-24T09:50:11Z", "node.statusChanged", { nodeRunId: approveRun.id, nodeId: "human-approve", attempt: 1, from: "running", to: "waiting_approval" }],
      ["2026-10-24T09:50:12Z", "run.statusChanged", { from: "running", to: "waiting_approval" }],
      ["2026-10-24T10:00:00Z", "approval.requested", { approval }],
    ];
    for (const [timestamp, type, payload] of setup) {
      appendEvent(scenario, timestamp, type, payload);
    }
    // Host expiry sweep: mirrored from approval-expired.json plus the §5
    // finalization the fixture slice leaves implicit.
    scenario.script.push(() => {
      const record = approvals.get(APPROVAL_EXPIRED)!;
      record.approval = { ...record.approval, status: "expired" };
      record.resolved = { decision: "expired", resolvedAt: isoNow() };
      appendEvent(scenario, isoNow(), "approval.resolved", {
        approvalId: APPROVAL_EXPIRED,
        decision: "expired",
        resolvedAt: isoNow(),
      });
      moveNodeRun(scenario, approveRun.id, "human-approve", 1, "failed", `approval expired at ${EXPIRED_AT_PAST}`);
      moveRun(scenario, "failed", "node human-approve failed: approval expired; stop-descendants applied");
      appendEvent(scenario, isoNow(), "run.failed", {
        reason: "node human-approve failed: approval expired; stop-descendants applied",
        errorCode: "APPROVAL_REQUIRED",
      });
      scenario.closed = true;
      scenario.run = { ...scenario.run, finishedAt: isoNow() };
    });
  }

  // --- RUN_STALE: interrupted run + approval from a previous generation ---
  {
    const run = seedRun({
      id: RUN_STALE,
      workflowSnapshot: workflowSnapshot(
        WORKFLOW_REVIEW,
        WORKFLOW_REVIEW_REV,
        "sample-review-flow",
        [
          { id: "draft-bot", type: "bot", botId: BOT_A, instructionTemplate: "Summarize the draft and emit a review." },
          { id: "human-approve", type: "approval", instructionTemplate: "Approve the summary before delivery." },
        ],
        [{ from: "draft-bot", to: "human-approve", key: "summary" }],
      ),
      botSnapshots: [noteBot],
      status: "interrupted",
      trigger: { kind: "manual", idempotencyKey: "10000000-0000-4000-8000-000000000006" },
      createdAt: "2026-10-24T09:40:00Z",
    });
    const draftRun = seedNodeRun("eeeeeeee-eeee-4eee-8eee-eeeeeeeee0d1", RUN_STALE, "draft-bot", 1, "succeeded", null);
    const approveRun = seedNodeRun("eeeeeeee-eeee-4eee-8eee-eeeeeeeee0d2", RUN_STALE, "human-approve", 1, "interrupted", null);
    registerNodeRuns(RUN_STALE, [draftRun, approveRun]);
    const scenario = registerScenario(run);
    const approval: Approval = {
      id: APPROVAL_STALE,
      runId: RUN_STALE,
      nodeRunId: approveRun.id,
      actionDigest: ACTION_DIGEST,
      resource: APPROVAL_RESOURCE,
      expiresAt: "2030-01-01T00:00:00Z",
      status: "pending",
    };
    // Generation 0: the host restarted since this approval was created, so
    // it is bound to a dead generation and can never be replayed (§2).
    approvals.set(APPROVAL_STALE, {
      approval,
      generation: 0,
      requestedAt: "2026-10-24T09:45:00Z",
    });
    const setup: [string, EventType, unknown][] = [
      ["2026-10-24T09:40:00Z", "run.created", { workflowId: WORKFLOW_REVIEW, triggerKind: "manual" }],
      ["2026-10-24T09:40:01Z", "run.statusChanged", { from: "queued", to: "running" }],
      ["2026-10-24T09:40:02Z", "node.statusChanged", { nodeRunId: draftRun.id, nodeId: "draft-bot", attempt: 1, from: "pending", to: "running" }],
      ["2026-10-24T09:40:10Z", "node.statusChanged", { nodeRunId: draftRun.id, nodeId: "draft-bot", attempt: 1, from: "running", to: "succeeded", reason: "node completed" }],
      ["2026-10-24T09:40:11Z", "node.statusChanged", { nodeRunId: approveRun.id, nodeId: "human-approve", attempt: 1, from: "pending", to: "running" }],
      ["2026-10-24T09:40:11Z", "node.statusChanged", { nodeRunId: approveRun.id, nodeId: "human-approve", attempt: 1, from: "running", to: "waiting_approval" }],
      ["2026-10-24T09:40:12Z", "run.statusChanged", { from: "running", to: "waiting_approval" }],
      ["2026-10-24T09:45:00Z", "approval.requested", { approval }],
      ["2026-10-24T09:46:00Z", "run.interrupted", { reason: "host process exited during a running turn" }],
      ["2026-10-24T09:46:00Z", "node.statusChanged", { nodeRunId: approveRun.id, nodeId: "human-approve", attempt: 1, from: "waiting_approval", to: "interrupted", reason: "host process exited" }],
      ["2026-10-24T09:46:00Z", "run.statusChanged", { from: "waiting_approval", to: "interrupted", reason: "host crash; the approval died with its generation" }],
    ];
    for (const [timestamp, type, payload] of setup) {
      appendEvent(scenario, timestamp, type, payload);
    }
  }

  // --- RUN_INTERRUPTED: crash-reconnect.json tail with retention loss -----
  {
    const run = seedRun({
      id: RUN_INTERRUPTED,
      workflowSnapshot: dailyNoteWorkflow,
      botSnapshots: [noteBot],
      status: "interrupted",
      trigger: { kind: "manual", idempotencyKey: "10000000-0000-4000-8000-000000000007" },
      createdAt: "2026-10-24T10:00:00Z",
    });
    const nodeRun = seedNodeRun("eeeeeeee-eeee-4eee-8eee-eeeeeeeeee0e", RUN_INTERRUPTED, "n1", 1, "interrupted", "sess-interrupted");
    registerNodeRuns(RUN_INTERRUPTED, [nodeRun]);
    // Only sequences >= 4 survive the restart (retention floor): a consumer
    // asking for anything older gets snapshotRequired=true, like
    // crash-reconnect.json interaction 2.
    const scenario = registerScenario(run, { retentionFloor: 4 });
    const tail: [number, string, EventType, unknown][] = [
      [4, "2026-10-24T10:03:00Z", "run.interrupted", { reason: "host process exited during a running turn" }],
      [5, "2026-10-24T10:04:00Z", "node.statusChanged", { nodeRunId: nodeRun.id, nodeId: "n1", attempt: 1, from: "running", to: "interrupted", reason: "host process exited" }],
      [6, "2026-10-24T10:04:00Z", "run.statusChanged", { from: "running", to: "interrupted", reason: "host crash; recovery creates a new run via resumedFromRunId" }],
    ];
    for (const [sequence, timestamp, type, payload] of tail) {
      scenario.events.push(
        EventEnvelopeSchema.parse({
          // crash-reconnect.json eventIds (0x12-0x14), runId remapped.
          eventId: `20000000-0000-4000-8000-0000000000${sequence + 8}`,
          runId: RUN_INTERRUPTED,
          sequence,
          timestamp,
          type,
          payload,
        }),
      );
    }
  }

  // --- RUN_RESUMED: new run linked via resumedFromRunId -------------------
  {
    const run = seedRun({
      id: RUN_RESUMED,
      workflowSnapshot: dailyNoteWorkflow,
      botSnapshots: [noteBot],
      status: "running",
      trigger: { kind: "manual", idempotencyKey: "10000000-0000-4000-8000-000000000008" },
      createdAt: "2026-10-24T10:04:30Z",
      resumedFromRunId: RUN_INTERRUPTED,
    });
    const nodeRun = seedNodeRun("e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1", RUN_RESUMED, "n1", 1, "running", "sess-resumed-run");
    registerNodeRuns(RUN_RESUMED, [nodeRun]);
    const scenario = registerScenario(run);
    scenario.events.push(
      EventEnvelopeSchema.parse({
        eventId: "20000000-0000-4000-8000-000000000015",
        runId: RUN_RESUMED,
        sequence: 0,
        timestamp: "2026-10-24T10:04:30Z",
        type: "run.created",
        payload: { workflowId: WORKFLOW_DAILY, triggerKind: "manual" },
      }),
    );
  }

  // --- RUN_RETRY: failed node in an active run (run.retryNode demo) -------
  {
    const workflow = workflowSnapshot(
      WORKFLOW_RETRY,
      WORKFLOW_RETRY_REV,
      "sample-retry-flow",
      [
        { id: "r1", type: "bot", botId: BOT_B, instructionTemplate: "Collect the sample digest (transient failures possible)." },
        { id: "r2", type: "bot", botId: BOT_A, instructionTemplate: "Summarize the collected digest." },
        { id: "r3", type: "bot", botId: BOT_B, instructionTemplate: "Publish the summary downstream." },
      ],
      [
        { from: "r1", to: "r3", key: "digest" },
      ],
    );
    const run = seedRun({
      id: RUN_RETRY,
      workflowSnapshot: workflow,
      botSnapshots: [researchBot, noteBot],
      status: "running",
      trigger: { kind: "manual", idempotencyKey: "10000000-0000-4000-8000-000000000009" },
      createdAt: "2026-10-24T10:35:00Z",
    });
    const r1 = seedNodeRun("e2e2e2e2-e2e2-4e2e-8e2e-e2e2e2e2e201", RUN_RETRY, "r1", 1, "failed", null);
    const r2 = seedNodeRun("e2e2e2e2-e2e2-4e2e-8e2e-e2e2e2e2e202", RUN_RETRY, "r2", 1, "running", "sess-retry-r2");
    const r3 = seedNodeRun("e2e2e2e2-e2e2-4e2e-8e2e-e2e2e2e2e203", RUN_RETRY, "r3", 1, "pending", null);
    registerNodeRuns(RUN_RETRY, [r1, r2, r3]);
    const scenario = registerScenario(run, {
      script: [
        // s1: everything finishes after the retried attempt succeeds.
        () => {
          const retried = (nodeRunsByRun.get(RUN_RETRY) ?? []).find(
            (entry) => entry.nodeId === "r1" && entry.attempt === 2,
          );
          if (!retried) {
            throw new ServiceError(
              "INVALID_INPUT",
              t("runs.replayOrderError"),
            );
          }
          moveNodeRun(scenario, retried.id, "r1", 2, "succeeded", "node completed");
          moveNodeRun(scenario, r2.id, "r2", 1, "succeeded", "node completed");
          moveNodeRun(scenario, r3.id, "r3", 1, "running");
          moveNodeRun(scenario, r3.id, "r3", 1, "succeeded", "node completed");
          moveRun(scenario, "succeeded", "all nodes finished");
          appendEvent(scenario, isoNow(), "run.completed", { finishedAt: isoNow() });
          scenario.closed = true;
          scenario.run = { ...scenario.run, finishedAt: isoNow() };
        },
      ],
    });
    const setup: [string, EventType, unknown][] = [
      ["2026-10-24T10:35:00Z", "run.created", { workflowId: WORKFLOW_RETRY, triggerKind: "manual" }],
      ["2026-10-24T10:35:01Z", "run.statusChanged", { from: "queued", to: "running" }],
      ["2026-10-24T10:35:02Z", "node.statusChanged", { nodeRunId: r1.id, nodeId: "r1", attempt: 1, from: "pending", to: "running" }],
      ["2026-10-24T10:35:02Z", "node.statusChanged", { nodeRunId: r2.id, nodeId: "r2", attempt: 1, from: "pending", to: "running" }],
      ["2026-10-24T10:35:20Z", "node.statusChanged", { nodeRunId: r1.id, nodeId: "r1", attempt: 1, from: "running", to: "failed", reason: "fixture: simulated transient tool error" }],
    ];
    for (const [timestamp, type, payload] of setup) {
      appendEvent(scenario, timestamp, type, payload);
    }
  }

  // -------------------------------------------------------------------------
  // Cancel drain script for RUN_ACTIVE: installed on the scenario so that
  // once the run is cancelling it is always the next playback step.
  // -------------------------------------------------------------------------
  {
    const scenario = scenarios.get(RUN_ACTIVE)!;
    scenario.cancelFinish = () => {
      const nodeRun = (nodeRunsByRun.get(RUN_ACTIVE) ?? [])[0]!;
      if (scenario.run.status !== "cancelling") {
        throw new ServiceError("INVALID_INPUT", t("runs.cancelNotStarted"));
      }
      moveNodeRun(scenario, nodeRun.id, "n1", 1, "cancelled", "graph cancellation stopped the node");
      moveRun(scenario, "cancelled", "all child work stopped");
      scenario.closed = true;
      scenario.run = { ...scenario.run, finishedAt: isoNow() };
    };
  }

  // -------------------------------------------------------------------------
  // API implementation
  // -------------------------------------------------------------------------

  const approvalBaseline = (record: ApprovalRecord): ApprovalBaseline => {
    const invalidReason: ApprovalBaseline["invalidReason"] | undefined =
      record.approval.status === "pending"
        ? record.generation < HOST_GENERATION
          ? "generation"
          : Date.now() > Date.parse(record.approval.expiresAt)
            ? "expired"
            : undefined
        : undefined;
    return {
      approval: record.approval,
      ...(record.resolved !== undefined ? { resolved: record.resolved } : {}),
      ...(invalidReason !== undefined ? { invalidReason } : {}),
      requestedAt: record.requestedAt,
    };
  };

  const service: RunServiceApi = {
    async list(query = {}) {
      const limit = query.limit ?? 50;
      const all = [...scenarios.values()]
        .map((scenario) => scenario.run)
        .filter((run) => query.status === undefined || run.status === query.status)
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
        .slice(0, limit);
      return { runs: all.map((run) => RunSchema.parse(run)), nextCursor: null };
    },

    async get(runId) {
      return RunSchema.parse(requireScenario(runId).run);
    },

    async listApprovals() {
      return [...approvals.values()].map(approvalBaseline);
    },

    async snapshot(runId) {
      const scenario = requireScenario(runId);
      const runApprovals = [...approvals.values()]
        .filter((record) => record.approval.runId === runId)
        .map(approvalBaseline);
      return {
        run: RunSchema.parse(scenario.run),
        nodeRuns: (nodeRunsByRun.get(runId) ?? []).map((entry) =>
          NodeRunSchema.parse(entry),
        ),
        approvals: runApprovals,
        artifacts: artifactsByRun.get(runId) ?? [],
      };
    },

    async subscribe(runId, afterSequence) {
      if (!Number.isInteger(afterSequence) || afterSequence < 0) {
        throw invalidInput("afterSequence must be a non-negative integer");
      }
      const scenario = requireScenario(runId);
      // Retention cannot fully honour the requested range: mirror
      // crash-reconnect.json interaction 2 (no partial gapped replay).
      if (afterSequence + 1 < scenario.retentionFloor) {
        return { events: [], snapshotRequired: true };
      }
      const events = scenario.events.filter(
        (event) => event.sequence > afterSequence,
      );
      if (scenario.injectDuplicate && afterSequence === 0 && events.length >= 3) {
        // At-least-once delivery demo: the envelope at index 2 arrives twice.
        const duplicated = events[2]!;
        return {
          events: [...events.slice(0, 3), duplicated, ...events.slice(3)],
          snapshotRequired: false,
        };
      }
      return { events, snapshotRequired: false };
    },

    async cancel(runId) {
      const scenario = requireScenario(runId);
      if (isRunTerminal(scenario.run.status)) {
        // Idempotent repeat: return the existing terminal state, no events
        // (cancel-run.json interaction 2).
        return RunSchema.parse(scenario.run);
      }
      if (scenario.run.status === "cancelling") {
        return RunSchema.parse(scenario.run);
      }
      if (!canTransitionRun(scenario.run.status, "cancelling")) {
        throw invalidInput(`run in status ${scenario.run.status} cannot be cancelled`);
      }
      const from = scenario.run.status;
      scenario.run = { ...scenario.run, status: "cancelling" };
      appendEvent(scenario, isoNow(), "run.statusChanged", {
        from,
        to: "cancelling",
        reason: "user requested cancellation",
      });
      return RunSchema.parse(scenario.run);
    },

    async retryNode(nodeRunId) {
      const location = nodeRunIndex.get(nodeRunId);
      if (!location) {
        throw invalidInput(`node run not found: ${nodeRunId}`);
      }
      const scenario = requireScenario(location.runId);
      const list = nodeRunsByRun.get(location.runId) ?? [];
      const target = list.find((entry) => entry.id === nodeRunId);
      if (!target) {
        throw invalidInput(`node run not found: ${nodeRunId}`);
      }
      if (isRunTerminal(scenario.run.status)) {
        throw invalidInput("terminal runs recover through a new run");
      }
      if (scenario.run.status === "cancelling") {
        throw invalidInput("run is cancelling");
      }
      if (target.status !== "failed") {
        throw invalidInput(`only failed node runs can be retried (status ${target.status})`);
      }
      const attempts = list.filter((entry) => entry.nodeId === target.nodeId);
      const latest = attempts[attempts.length - 1]!;
      if (latest.id !== nodeRunId) {
        throw invalidInput("a newer attempt already exists for this node");
      }
      // Descendant progress check (edges of the run's own snapshot).
      const descendants = scenario.run.workflowSnapshot.edges
        .filter((edge) => edge.fromNodeId === target.nodeId)
        .map((edge) => edge.toNodeId);
      for (const descendantId of descendants) {
        const descendant = list
          .filter((entry) => entry.nodeId === descendantId)
          .sort((a, b) => a.attempt - b.attempt)
          .at(-1);
        if (
          descendant &&
          (descendant.status === "succeeded" ||
            descendant.status === "running" ||
            descendant.status === "waiting_approval")
        ) {
          throw invalidInput(
            `downstream nodes already progressed (${descendantId}: ${descendant.status})`,
          );
        }
      }
      const spawned = NodeRunSchema.parse({
        id: `e2e2e2e2-e2e2-4e2e-8e2e-${(0x300 + attempts.length).toString(16).padStart(12, "0")}`,
        runId: location.runId,
        nodeId: target.nodeId,
        attempt: attempts.length + 1,
        status: "running",
        inputRefs: [],
        outputRefs: [],
        sessionId: null,
      });
      nodeRunsByRun.set(location.runId, [...list, spawned]);
      nodeRunIndex.set(spawned.id, { runId: location.runId, nodeId: target.nodeId });
      appendEvent(scenario, isoNow(), "node.statusChanged", {
        nodeRunId: spawned.id,
        nodeId: target.nodeId,
        attempt: spawned.attempt,
        from: "pending",
        to: "running",
      });
      return spawned;
    },

    async decideApproval(input) {
      const record = approvals.get(input.approvalId);
      if (!record) {
        throw invalidInput(`approval not found: ${input.approvalId}`);
      }
      if (input.expectedActionDigest !== record.approval.actionDigest) {
        throw invalidInput("expectedActionDigest does not match the requested action");
      }
      if (record.approval.status !== "pending") {
        throw invalidInput(t("runs.approvalDecidedOnce", [record.approval.status]));
      }
      if (record.generation < HOST_GENERATION) {
        throw new ServiceError(
          "APPROVAL_EXPIRED",
          t("runs.approvalStaleGeneration"),
        );
      }
      if (Date.now() > Date.parse(record.approval.expiresAt)) {
        throw new ServiceError(
          "APPROVAL_EXPIRED",
          "approval expired before a decision was recorded",
        );
      }
      const scenario = requireScenario(record.approval.runId);
      const resolvedAt = isoNow();
      record.resolved = { decision: input.decision, resolvedAt };
      record.approval = { ...record.approval, status: input.decision };
      appendEvent(scenario, resolvedAt, "approval.resolved", {
        approvalId: record.approval.id,
        decision: input.decision,
        resolvedAt,
      });
      const approveNodeRunId = record.approval.nodeRunId;
      const approveNode = (nodeRunsByRun.get(scenario.run.id) ?? []).find(
        (entry) => entry.id === approveNodeRunId,
      );
      if (!approveNode) {
        throw invalidInput("approval references an unknown node run (fixture corrupt)");
      }
      if (input.decision === "approved") {
        moveNodeRun(scenario, approveNode.id, approveNode.nodeId, approveNode.attempt, "running");
        moveRun(scenario, "running");
        // Execution consumes the approval (one-shot), then the finish script
        // completes the run: node → succeeded, run → succeeded + artifacts.
        scenario.script.push(() => {
          record.approval = { ...record.approval, status: "consumed" };
          moveNodeRun(scenario, approveNode.id, approveNode.nodeId, approveNode.attempt, "succeeded", "node completed");
          const artifact: Artifact = {
            id: "23452345-2345-4234-8234-234523452346",
            runId: scenario.run.id,
            nodeRunId: approveNode.id,
            relativePath: "reports/review.md",
            mediaType: "text/markdown",
            size: 4096,
            checksum: { algorithm: "sha256", value: "b".repeat(64) },
          };
          artifactsByRun.set(scenario.run.id, [
            ...(artifactsByRun.get(scenario.run.id) ?? []),
            artifact,
          ]);
          appendEvent(scenario, isoNow(), "artifact.created", { artifact });
          moveRun(scenario, "succeeded", "all nodes finished");
          appendEvent(scenario, isoNow(), "run.completed", { finishedAt: isoNow() });
          scenario.closed = true;
          scenario.run = { ...scenario.run, finishedAt: isoNow() };
        });
      } else {
        // approval-denied.json: node failed, stop-descendants, run failed.
        moveNodeRun(scenario, approveNode.id, approveNode.nodeId, approveNode.attempt, "failed", "operator denied the requested action");
        const reason = `node ${approveNode.nodeId} failed: approval denied; stop-descendants applied`;
        moveRun(scenario, "failed", reason);
        appendEvent(scenario, isoNow(), "run.failed", { reason, errorCode: "APPROVAL_REQUIRED" });
        scenario.closed = true;
        scenario.run = { ...scenario.run, finishedAt: isoNow() };
      }
      return record.approval;
    },

    async pullTransient(runId) {
      const scenario = requireScenario(runId);
      const drained = scenario.transient;
      scenario.transient = [];
      return drained;
    },

    async advanceScenario(runId) {
      const scenario = requireScenario(runId);
      if (scenario.closed) {
        throw invalidInput(t("runs.terminalNoMoreEvents"));
      }
      // A cancelling run always drains next (child work stops → cancelled).
      if (scenario.run.status === "cancelling" && scenario.cancelFinish) {
        scenario.cancelFinish();
        return;
      }
      const step = scenario.script[scenario.scriptIndex];
      if (!step) {
        throw invalidInput(t("runs.replayScriptEnded"));
      }
      scenario.scriptIndex += 1;
      step();
    },
  };

  return service;
}
