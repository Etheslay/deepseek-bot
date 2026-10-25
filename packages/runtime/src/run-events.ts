/**
 * Per-run persistent event emitter (docs/CONTRACTS.md §4).
 *
 * Sequences continue from the last persisted value, so events written after
 * a host restart never reuse a number (QA-09: 重复/丢失事件去重). Payload
 * shape, sequence continuity and eventId deduplication are enforced by the
 * storage layer on every append; engine state is committed before events are
 * emitted (CONTRACTS §4: run.completed 在持久事务成功后发送).
 */
import { randomUUID } from "node:crypto";
import type { EventEnvelope, EventType } from "@deepseek-bot/contracts";
import { appendEvent, maxEventSequence, type OpenedDatabase } from "@deepseek-bot/storage";

export class RunEventEmitter {
  private nextSequence: number;

  constructor(
    private readonly db: OpenedDatabase,
    readonly runId: string,
    private readonly now: () => Date,
  ) {
    this.nextSequence = maxEventSequence(db, runId) + 1;
  }

  emit(type: EventType, payload: unknown): EventEnvelope {
    const envelope: EventEnvelope = {
      eventId: randomUUID(),
      runId: this.runId,
      sequence: this.nextSequence,
      timestamp: this.now().toISOString(),
      type,
      payload,
    };
    appendEvent(this.db, envelope);
    this.nextSequence += 1;
    return envelope;
  }
}
