/**
 * Local scheduler (D10, FR-08 本地调度, CONTRACTS §2 Schedule / §3
 * schedule.*).
 *
 * While the host runs (app open or tray resident — the Host wires start/stop
 * to its lifecycle), a self-resequencing timer ticks and starts due runs
 * through the WorkflowEngine. Guarantees:
 * - 时区明确: occurrences are computed per schedule's IANA zone (cron.ts);
 * - 重复触发防护: one Run per (scheduleId, occurrenceUtc) — the unique index
 *   on runs deduplicates even across restarts and racing ticks;
 * - 休眠错过任务: occurrences observed later than the misfire grace window
 *   are never batch re-run. The v0.1 misfirePolicy is fixed to
 *   skip-and-notify (CONTRACTS §2): each missed occurrence is recorded
 *   (schedule_misses, QA-10 错过可见) and the schedule advances to the next
 *   future occurrence;
 * - 重启中断状态: the first tick after start() evaluates past-due
 *   occurrences with the same skip-and-notify path, and startRun's
 *   occurrence dedup turns a crash between trigger and advance into a
 *   harmless duplicate.
 *
 * Does NOT own: the desktop IPC surface for schedule.* methods (D12) or the
 * Harness process (engine/executor).
 */
import { randomUUID } from "node:crypto";
import {
  MISFIRE_POLICY,
  type Schedule,
} from "@deepseek-bot/contracts";
import {
  listScheduleMisses,
  listSchedules,
  recordScheduleMiss,
  saveSchedule,
  setScheduleEnabled,
  setScheduleNextRunAt,
  type OpenedDatabase,
} from "@deepseek-bot/storage";
import type { WorkflowEngine } from "../engine.js";
import { nextCronOccurrence, parseCronExpression } from "./cron.js";

const DEFAULT_TICK_INTERVAL_MS = 30_000;
/** Occurrences later than this when first observed are misfires (FR-08). */
const DEFAULT_MISFIRE_GRACE_MS = 60_000;
/** Runaway guard when recording a long sleep's missed occurrences. */
const DEFAULT_MAX_RECORDED_MISSES = 500;

export type ScheduleTriggerOutcome =
  | "triggered"
  | "duplicate"
  | "missed"
  | "trigger-failed";

export interface ScheduleTriggerResult {
  readonly scheduleId: string;
  readonly occurrenceUtc: string | null;
  readonly outcome: ScheduleTriggerOutcome;
  readonly runId?: string;
  readonly reason?: string;
}

/** Payload of the skip-and-notify hook the Host can surface to the UI. */
export interface ScheduleMissNotice {
  readonly scheduleId: string;
  readonly workflowId: string;
  readonly occurrenceUtc: string;
  readonly reason: string;
}

export interface ScheduleDraftInput {
  readonly id?: string;
  readonly workflowId: string;
  readonly timezone: string;
  /** 5-field cron expression (CONTRACTS §2). */
  readonly recurrence: string;
  readonly enabled?: boolean;
}

export interface LocalSchedulerOptions {
  readonly db: OpenedDatabase;
  readonly engine: WorkflowEngine;
  readonly now?: () => Date;
  /** Tick cadence while the host is running. Default 30s. */
  readonly tickIntervalMs?: number;
  /** Default 60s; must be ≥ one tick so normal jitter is not a misfire. */
  readonly misfireGraceMs?: number;
  readonly maxRecordedMissesPerTick?: number;
  /** Called once per tick with the missed occurrences recorded in it. */
  readonly onMissed?: (notices: ReadonlyArray<ScheduleMissNotice>) => void;
}

export class LocalScheduler {
  private readonly now: () => Date;
  private readonly tickIntervalMs: number;
  private readonly misfireGraceMs: number;
  private readonly maxRecordedMissesPerTick: number;
  private timer: NodeJS.Timeout | undefined;
  private active = false;

  constructor(private readonly options: LocalSchedulerOptions) {
    this.now = options.now ?? (() => new Date());
    this.tickIntervalMs = options.tickIntervalMs ?? DEFAULT_TICK_INTERVAL_MS;
    this.misfireGraceMs = options.misfireGraceMs ?? DEFAULT_MISFIRE_GRACE_MS;
    this.maxRecordedMissesPerTick =
      options.maxRecordedMissesPerTick ?? DEFAULT_MAX_RECORDED_MISSES;
  }

  get isRunning(): boolean {
    return this.active;
  }

  /**
   * Begin ticking. The first tick runs synchronously so restart-misfires are
   * evaluated before the host reports readiness; later ticks re-sequence
   * themselves so they never overlap.
   */
  start(): void {
    if (this.active) {
      return;
    }
    this.active = true;
    this.tick();
    this.scheduleNextTick();
  }

  /** Stop ticking (host shutdown, tray exit). Idempotent. */
  stop(): void {
    this.active = false;
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  private scheduleNextTick(): void {
    if (!this.active) {
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = undefined;
      if (!this.active) {
        return;
      }
      this.tick();
      this.scheduleNextTick();
    }, this.tickIntervalMs);
  }

  /**
   * One scheduler pass over all enabled schedules. Public for tests and for
   * hosts that prefer manual driving.
   */
  tick(): ScheduleTriggerResult[] {
    const db = this.options.db;
    const now = this.now();
    const notices: ScheduleMissNotice[] = [];
    const results: ScheduleTriggerResult[] = [];
    for (const schedule of listSchedules(db, { enabledOnly: true })) {
      const result = this.processSchedule(schedule, now, notices);
      if (result !== undefined) {
        results.push(result);
      }
    }
    if (notices.length > 0) {
      this.options.onMissed?.(notices);
    }
    return results;
  }

  /**
   * Evaluate one schedule against `now`. Returns undefined when the schedule
   * was not due and no bookkeeping changed.
   */
  private processSchedule(
    schedule: Schedule,
    now: Date,
    notices: ScheduleMissNotice[],
  ): ScheduleTriggerResult | undefined {
    const db = this.options.db;
    const cron = parseCronExpression(schedule.recurrence);

    if (schedule.nextRunAt === null) {
      // Saved without a computed time (e.g. re-enabled after import):
      // schedule from now; a past-due never existed in this state.
      const next = nextCronOccurrence(cron, schedule.timezone, now);
      setScheduleNextRunAt(db, {
        id: schedule.id,
        nextRunAt: next?.toISOString() ?? null,
      });
      return undefined;
    }

    const due = new Date(schedule.nextRunAt);
    if (due.getTime() > now.getTime()) {
      return undefined;
    }

    const latenessMs = now.getTime() - due.getTime();
    if (latenessMs > this.misfireGraceMs) {
      return this.recordMisfire(schedule, cron, due, now, latenessMs, notices);
    }
    return this.triggerOccurrence(schedule, cron, due, notices);
  }

  /**
   * skip-and-notify (CONTRACTS §2): record every missed occurrence — bounded
   * for pathological sleeps — and advance to the next future occurrence
   * without running anything.
   */
  private recordMisfire(
    schedule: Schedule,
    cron: ReturnType<typeof parseCronExpression>,
    due: Date,
    now: Date,
    latenessMs: number,
    notices: ScheduleMissNotice[],
  ): ScheduleTriggerResult {
    const db = this.options.db;
    const reason =
      `occurrence missed while the host was unavailable ` +
      `(${Math.round(latenessMs / 1000)}s late); misfire policy skip-and-notify`;
    let occurrence: Date | null = due;
    let recorded = 0;
    while (
      occurrence !== null &&
      occurrence.getTime() <= now.getTime() &&
      recorded < this.maxRecordedMissesPerTick
    ) {
      const occurrenceUtc = occurrence.toISOString();
      recordScheduleMiss(db, {
        id: randomUUID(),
        scheduleId: schedule.id,
        occurrenceUtc,
        reason,
        detectedAt: now.toISOString(),
      });
      notices.push({
        scheduleId: schedule.id,
        workflowId: schedule.workflowId,
        occurrenceUtc,
        reason,
      });
      recorded += 1;
      occurrence = nextCronOccurrence(cron, schedule.timezone, occurrence);
    }
    const next = nextCronOccurrence(cron, schedule.timezone, now);
    setScheduleNextRunAt(db, {
      id: schedule.id,
      nextRunAt: next?.toISOString() ?? null,
    });
    return {
      scheduleId: schedule.id,
      occurrenceUtc: due.toISOString(),
      outcome: "missed",
      reason,
    };
  }

  /**
   * Start a run for the due occurrence. The engine deduplicates on
   * (scheduleId, occurrenceUtc), so a crash after startRun but before the
   * nextRunAt advance replays as a duplicate on the next tick, never as a
   * second run. Trigger failures (archived bot, invalid workflow...) are
   * recorded as visible misses and the schedule advances past the broken
   * occurrence instead of retrying it forever.
   */
  private triggerOccurrence(
    schedule: Schedule,
    cron: ReturnType<typeof parseCronExpression>,
    due: Date,
    notices: ScheduleMissNotice[],
  ): ScheduleTriggerResult {
    const db = this.options.db;
    const occurrenceUtc = due.toISOString();
    let result: ScheduleTriggerResult;
    try {
      const { run, created } = this.options.engine.startRun({
        workflowId: schedule.workflowId,
        trigger: {
          kind: "schedule",
          idempotencyKey: randomUUID(),
          scheduleId: schedule.id,
          occurrenceUtc,
        },
      });
      result = {
        scheduleId: schedule.id,
        occurrenceUtc,
        outcome: created ? "triggered" : "duplicate",
        runId: run.id,
      };
    } catch (error) {
      const reason = truncate(
        `schedule trigger failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      recordScheduleMiss(db, {
        id: randomUUID(),
        scheduleId: schedule.id,
        occurrenceUtc,
        reason,
        detectedAt: this.now().toISOString(),
      });
      notices.push({
        scheduleId: schedule.id,
        workflowId: schedule.workflowId,
        occurrenceUtc,
        reason,
      });
      result = { scheduleId: schedule.id, occurrenceUtc, outcome: "trigger-failed", reason };
    }
    const next = nextCronOccurrence(cron, schedule.timezone, due);
    setScheduleNextRunAt(db, {
      id: schedule.id,
      nextRunAt: next?.toISOString() ?? null,
    });
    return result;
  }

  // -------------------------------------------------------------------------
  // schedule.save / enable / disable facade (CONTRACTS §3)
  // -------------------------------------------------------------------------

  /**
   * Validate and persist a schedule, computing nextRunAt from now when
   * enabled. The Host's schedule.save method (D12) calls this.
   */
  upsertSchedule(draft: ScheduleDraftInput): Schedule {
    // Grammar validation up front (INVALID_INPUT with field details);
    // ScheduleSchema in storage then re-validates the persisted entity, and
    // nextCronOccurrence rejects unknown zones.
    const cron = parseCronExpression(draft.recurrence);
    const enabled = draft.enabled ?? true;
    const nextRunAt = enabled
      ? nextCronOccurrence(cron, draft.timezone, this.now())?.toISOString() ?? null
      : null;
    return saveSchedule(this.options.db, {
      id: draft.id ?? randomUUID(),
      workflowId: draft.workflowId,
      timezone: draft.timezone,
      recurrence: draft.recurrence,
      nextRunAt,
      enabled,
      misfirePolicy: MISFIRE_POLICY,
    });
  }

  /**
   * Enable or disable a schedule. Enabling recomputes nextRunAt from now
   * when it is unset or already past (the elapsed occurrences stay gone —
   * re-enabling is not a batch catch-up, FR-08).
   */
  setEnabled(input: { id: string; enabled: boolean }): Schedule {
    const db = this.options.db;
    const updated = setScheduleEnabled(db, input);
    if (!input.enabled) {
      return updated;
    }
    if (
      updated.nextRunAt !== null &&
      new Date(updated.nextRunAt).getTime() > this.now().getTime()
    ) {
      return updated;
    }
    const next = nextCronOccurrence(
      parseCronExpression(updated.recurrence),
      updated.timezone,
      this.now(),
    );
    return setScheduleNextRunAt(db, {
      id: updated.id,
      nextRunAt: next?.toISOString() ?? null,
    });
  }

  /** Missed occurrences for the UI (QA-10 错过可见). */
  listMisses(scheduleId?: string) {
    return listScheduleMisses(this.options.db, scheduleId === undefined ? {} : { scheduleId });
  }
}

function truncate(reason: string, limit = 500): string {
  return reason.length > limit ? reason.slice(0, limit) : reason;
}
