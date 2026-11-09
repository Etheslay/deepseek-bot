/**
 * Chat message schedules.
 *
 * Workflow schedules start a run. These start nothing: at the saved local
 * clock the host writes the saved text into that bot's chat. The app has to
 * be running. An occurrence more than a few minutes late is skipped, and a
 * long sleep does not replay every missed hello.
 */
import type { BotMessageSchedule } from "@deepseek-bot/storage";
import {
  claimBotMessageDelivery,
  disableBotMessageSchedule,
  listEnabledBotMessageSchedules,
  releaseBotMessageDelivery,
  setBotMessageScheduleNextRunAt,
  type OpenedDatabase,
} from "@deepseek-bot/storage";
import { nextCronOccurrence, parseCronExpression } from "./cron.js";

const DEFAULT_TICK_INTERVAL_MS = 30_000;
/** A tick that lands a few minutes late still sends. Longer than that is a miss. */
const DEFAULT_MISFIRE_GRACE_MS = 5 * 60_000;

export type BotMessageTriggerOutcome = "triggered" | "duplicate" | "missed" | "trigger-failed";

export interface BotMessageTriggerResult {
  readonly scheduleId: string;
  readonly occurrenceUtc: string | null;
  readonly outcome: BotMessageTriggerOutcome;
  readonly reason?: string;
}

export interface BotMessageSchedulerOptions {
  readonly db: OpenedDatabase;
  readonly deliver: (schedule: BotMessageSchedule) => void;
  readonly now?: () => Date;
  readonly tickIntervalMs?: number;
  readonly misfireGraceMs?: number;
}

export function messageScheduleRecurrence(input: {
  hour: number;
  minute: number;
  days: "every" | "weekdays";
}): string {
  const days = input.days === "weekdays" ? "1-5" : "*";
  return `${input.minute} ${input.hour} * * ${days}`;
}

export class BotMessageScheduler {
  private readonly now: () => Date;
  private readonly tickIntervalMs: number;
  private readonly misfireGraceMs: number;
  private timer: NodeJS.Timeout | undefined;
  private active = false;

  constructor(private readonly options: BotMessageSchedulerOptions) {
    this.now = options.now ?? (() => new Date());
    this.tickIntervalMs = options.tickIntervalMs ?? DEFAULT_TICK_INTERVAL_MS;
    this.misfireGraceMs = options.misfireGraceMs ?? DEFAULT_MISFIRE_GRACE_MS;
  }

  start(): void {
    if (this.active) {
      return;
    }
    this.active = true;
    this.tick();
    this.scheduleNextTick();
  }

  stop(): void {
    this.active = false;
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  tick(): BotMessageTriggerResult[] {
    const now = this.now();
    const results: BotMessageTriggerResult[] = [];
    for (const schedule of listEnabledBotMessageSchedules(this.options.db)) {
      const result = this.process(schedule, now);
      if (result !== undefined) {
        results.push(result);
      }
    }
    return results;
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

  private process(schedule: BotMessageSchedule, now: Date): BotMessageTriggerResult | undefined {
    const db = this.options.db;
    let cron: ReturnType<typeof parseCronExpression>;
    try {
      cron = parseCronExpression(schedule.recurrence);
    } catch (error) {
      disableBotMessageSchedule(db, schedule.id);
      return {
        scheduleId: schedule.id,
        occurrenceUtc: null,
        outcome: "trigger-failed",
        reason: error instanceof Error ? error.message : String(error),
      };
    }
    if (schedule.nextRunAt === null) {
      const next = nextCronOccurrence(cron, schedule.timezone, now);
      setBotMessageScheduleNextRunAt(db, {
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
      const next = nextCronOccurrence(cron, schedule.timezone, now);
      setBotMessageScheduleNextRunAt(db, {
        id: schedule.id,
        nextRunAt: next?.toISOString() ?? null,
      });
      return {
        scheduleId: schedule.id,
        occurrenceUtc: due.toISOString(),
        outcome: "missed",
        reason: "occurrence missed while the app was not running",
      };
    }
    const occurrenceUtc = due.toISOString();
    const claimed = claimBotMessageDelivery(db, { scheduleId: schedule.id, occurrenceUtc });
    if (!claimed) {
      this.advance(schedule, cron, due);
      return { scheduleId: schedule.id, occurrenceUtc, outcome: "duplicate" };
    }
    try {
      this.options.deliver(schedule);
    } catch (error) {
      releaseBotMessageDelivery(db, { scheduleId: schedule.id, occurrenceUtc });
      this.advance(schedule, cron, due);
      return {
        scheduleId: schedule.id,
        occurrenceUtc,
        outcome: "trigger-failed",
        reason: error instanceof Error ? error.message : String(error),
      };
    }
    this.advance(schedule, cron, due);
    return { scheduleId: schedule.id, occurrenceUtc, outcome: "triggered" };
  }

  private advance(
    schedule: BotMessageSchedule,
    cron: ReturnType<typeof parseCronExpression>,
    due: Date,
  ): void {
    const next = nextCronOccurrence(cron, schedule.timezone, due);
    setBotMessageScheduleNextRunAt(this.options.db, {
      id: schedule.id,
      nextRunAt: next?.toISOString() ?? null,
    });
  }
}
