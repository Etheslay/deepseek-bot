/**
 * Persistent event contract (docs/CONTRACTS.md §4).
 *
 * Envelopes carry eventId/runId/sequence/timestamp/type/payload. `sequence`
 * is strictly increasing within one Run, survives host restarts and never
 * replays history. Delivery is at-least-once: consumers deduplicate by
 * eventId/sequence. `assistant.delta` is a transient stream (streamId +
 * chunkIndex), occupies no persistent sequence and is not replayed.
 */
import { z } from "zod";
import {
  ApprovalSchema,
  ArtifactSchema,
} from "./entities.js";
import {
  IsoDateTimeUtcSchema,
  NonEmptyStringSchema,
  TEXT_LIMITS,
  UuidSchema,
} from "./primitives.js";
import {
  isNodeRunTerminal,
  isRunTerminal,
  isTaskTerminal,
  NODE_RUN_STATUSES,
  RUN_STATUSES,
  TASK_STATUSES,
} from "./status.js";

export const EVENT_TYPES = [
  "run.created",
  "run.statusChanged",
  "node.statusChanged",
  "tool.requested",
  "approval.requested",
  "approval.resolved",
  "artifact.created",
  "run.completed",
  "run.failed",
  "run.interrupted",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export const EventEnvelopeSchema = z.object({
  eventId: UuidSchema,
  runId: UuidSchema,
  sequence: z.int().nonnegative(),
  timestamp: IsoDateTimeUtcSchema,
  type: z.enum(EVENT_TYPES),
  payload: z.unknown(),
});

export type EventEnvelope = z.infer<typeof EventEnvelopeSchema>;

// ---------------------------------------------------------------------------
// Per-type payloads. Terminal states must always carry a reason.
// ---------------------------------------------------------------------------

const RunStatusChangedPayloadSchema = z
  .object({
    from: z.enum(RUN_STATUSES),
    to: z.enum(RUN_STATUSES),
    reason: z.string().max(TEXT_LIMITS.reason).optional(),
  })
  .refine(
    (payload) => !isRunTerminal(payload.to) || payload.reason !== undefined,
    { message: "terminal run states require a reason" },
  );

const NodeStatusChangedPayloadSchema = z
  .object({
    nodeRunId: UuidSchema,
    nodeId: NonEmptyStringSchema(TEXT_LIMITS.label),
    attempt: z.int().positive(),
    from: z.enum(NODE_RUN_STATUSES),
    to: z.enum(NODE_RUN_STATUSES),
    reason: z.string().max(TEXT_LIMITS.reason).optional(),
  })
  .refine(
    (payload) => !isNodeRunTerminal(payload.to) || payload.reason !== undefined,
    { message: "terminal node states require a reason" },
  );

export const EVENT_PAYLOAD_SCHEMAS: Readonly<
  Record<EventType, z.ZodType>
> = {
  "run.created": z.object({
    workflowId: UuidSchema,
    triggerKind: z.enum(["manual", "schedule"]),
  }),
  "run.statusChanged": RunStatusChangedPayloadSchema,
  "node.statusChanged": NodeStatusChangedPayloadSchema,
  "tool.requested": z.object({
    nodeRunId: UuidSchema,
    callId: NonEmptyStringSchema(TEXT_LIMITS.label),
    toolName: NonEmptyStringSchema(TEXT_LIMITS.label),
    /** Data only, never executable host code; must fit the message limit. */
    arguments: z.unknown().optional(),
    resource: z.string().max(TEXT_LIMITS.path).optional(),
  }),
  "approval.requested": z.object({
    approval: ApprovalSchema,
  }),
  "approval.resolved": z.object({
    approvalId: UuidSchema,
    decision: z.enum(["approved", "denied", "expired"]),
    resolvedAt: IsoDateTimeUtcSchema,
  }),
  "artifact.created": z.object({
    artifact: ArtifactSchema,
  }),
  "run.completed": z.object({
    finishedAt: IsoDateTimeUtcSchema,
  }),
  "run.failed": z.object({
    reason: z.string().min(1).max(TEXT_LIMITS.reason),
    errorCode: z.string().min(1),
  }),
  "run.interrupted": z.object({
    reason: z.string().min(1).max(TEXT_LIMITS.reason),
    resumedFromRunId: UuidSchema.optional(),
  }),
};

export function parseEventPayload(
  event: Pick<EventEnvelope, "type" | "payload">,
): z.ZodSafeParseResult<unknown> {
  return EVENT_PAYLOAD_SCHEMAS[event.type].safeParse(event.payload);
}

// ---------------------------------------------------------------------------
// Task events (v0.5 manager orchestration). The persistent `events` log is
// run-scoped (envelope.runId is a foreign key into runs), so dispatched-task
 // transitions persist in their own task_events log with the same delivery
// semantics: at-least-once, deduplicated by eventId, per-task strictly
// increasing sequence, replay by afterSequence.
// ---------------------------------------------------------------------------

export const TASK_EVENT_TYPES = ["task.status"] as const;

export type TaskEventType = (typeof TASK_EVENT_TYPES)[number];

export const TaskEventEnvelopeSchema = z.object({
  eventId: UuidSchema,
  taskId: UuidSchema,
  sequence: z.int().nonnegative(),
  timestamp: IsoDateTimeUtcSchema,
  type: z.enum(TASK_EVENT_TYPES),
  payload: z.unknown(),
});

export type TaskEventEnvelope = z.infer<typeof TaskEventEnvelopeSchema>;

const TaskStatusChangedPayloadSchema = z
  .object({
    taskId: UuidSchema,
    from: z.enum(TASK_STATUSES),
    to: z.enum(TASK_STATUSES),
    reason: z.string().max(TEXT_LIMITS.reason).optional(),
  })
  .refine((payload) => !isTaskTerminal(payload.to) || payload.reason !== undefined, {
    message: "terminal task states require a reason",
  });

export const TASK_EVENT_PAYLOAD_SCHEMAS: Readonly<Record<TaskEventType, z.ZodType>> = {
  "task.status": TaskStatusChangedPayloadSchema,
};

export function parseTaskEventPayload(
  event: Pick<TaskEventEnvelope, "type" | "payload">,
): z.ZodSafeParseResult<unknown> {
  return TASK_EVENT_PAYLOAD_SCHEMAS[event.type].safeParse(event.payload);
}

// ---------------------------------------------------------------------------
// Transient stream
// ---------------------------------------------------------------------------

export const AssistantDeltaSchema = z.object({
  streamId: NonEmptyStringSchema(TEXT_LIMITS.label),
  chunkIndex: z.int().nonnegative(),
  textDelta: z.string().optional(),
  reasoningDelta: z.string().optional(),
  toolDelta: z.unknown().optional(),
});

export type AssistantDelta = z.infer<typeof AssistantDeltaSchema>;

/**
 * B6 incremental streaming: one live assistant segment the Host pushes to the
 * desktop over the server→client `chat.stream` notification (the wire twin of
 * `schedule.missed`). The pinned harness settles a whole assistant message per
 * model attempt, so a segment is a full message text, not a token delta; the
 * turn's authoritative reply stays the `chat.send` response. Transient wire
 * notice — no persistence, no replay; clients predating the channel ignore it.
 */
export const ChatStreamNoticeSchema = z.object({
  botId: UuidSchema,
  sessionId: NonEmptyStringSchema(TEXT_LIMITS.label),
  text: NonEmptyStringSchema(TEXT_LIMITS.streamSegment),
});

export type ChatStreamNotice = z.infer<typeof ChatStreamNoticeSchema>;

/** True when `events` has strictly increasing `sequence` values. */
export function isSequenceMonotonic(
  events: readonly { sequence: number }[],
): boolean {
  for (let i = 1; i < events.length; i += 1) {
    const previous = events[i - 1];
    const current = events[i];
    if (previous === undefined || current === undefined) {
      return false;
    }
    if (current.sequence <= previous.sequence) {
      return false;
    }
  }
  return true;
}
