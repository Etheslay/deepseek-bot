/**
 * 5-field cron evaluation with IANA time-zone semantics (D10, CONTRACTS §2
 * Schedule, FR-08 时区明确).
 *
 * The grammar is the v0.1 contract's: `minute hour day-of-month month
 * day-of-week` with `*`, lists, ranges and steps (numeric only). DOM/DOW
 * restriction follows vixie cron: when both fields are restricted the day
 * matches if EITHER matches.
 *
 * Occurrences are wall-clock minutes in the schedule's IANA zone, converted
 * to UTC instants through Intl:
 * - spring-forward gaps (a wall minute that does not exist) produce no
 *   occurrence — cron semantics skip them;
 * - fall-back overlaps (a wall minute that happens twice) produce both
 *   instants, and `nextCronOccurrence` returns the earliest instant strictly
 *   after the reference time, not merely the next wall minute, so the second
 *   pass of an earlier minute is never missed (QA-10 时区/DST).
 */
import { isValidIanaTimeZone } from "@deepseek-bot/contracts";
import { invalidInput } from "../errors.js";

export interface CronExpression {
  readonly expression: string;
  readonly minutes: ReadonlySet<number>;
  readonly hours: ReadonlySet<number>;
  readonly daysOfMonth: ReadonlySet<number>;
  readonly months: ReadonlySet<number>;
  /** 0-6 with 0 = Sunday; the input's 7 is normalized to 0. */
  readonly daysOfWeek: ReadonlySet<number>;
  readonly domRestricted: boolean;
  readonly dowRestricted: boolean;
}

interface FieldBounds {
  readonly min: number;
  readonly max: number;
  readonly label: string;
}

const FIELDS: ReadonlyArray<FieldBounds> = [
  { min: 0, max: 59, label: "minute" },
  { min: 0, max: 23, label: "hour" },
  { min: 1, max: 31, label: "day-of-month" },
  { min: 1, max: 12, label: "month" },
  { min: 0, max: 7, label: "day-of-week" },
];

const DAY_MS = 86_400_000;
/** Calendar-day search bound: a matching day must occur within 4 years. */
const MAX_SEARCH_DAYS = 366 * 4 + 2;

export function parseCronExpression(expression: string): CronExpression {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw invalidInput("expected a 5-field cron expression", {
      expression,
      fields: fields.length,
    });
  }
  const minutes = parseField(fields[0]!, FIELDS[0]!);
  const hours = parseField(fields[1]!, FIELDS[1]!);
  const daysOfMonth = parseField(fields[2]!, FIELDS[2]!);
  const months = parseField(fields[3]!, FIELDS[3]!);
  const daysOfWeek = parseField(fields[4]!, FIELDS[4]!);
  return {
    expression,
    minutes,
    hours,
    daysOfMonth,
    months,
    daysOfWeek,
    domRestricted: fields[2] !== "*",
    dowRestricted: fields[4] !== "*",
  };
}

function parseField(field: string, bounds: FieldBounds): Set<number> {
  const values = new Set<number>();
  for (const term of field.split(",")) {
    if (term === "") {
      throw fieldError(bounds, field, "empty list term");
    }
    const [rangePart, stepPart] = term.split("/");
    if (rangePart === undefined || rangePart === "") {
      throw fieldError(bounds, field, "empty list term");
    }
    if (stepPart !== undefined && !/^\d+$/.test(stepPart)) {
      throw fieldError(bounds, field, "step must be a positive integer");
    }
    const step = stepPart === undefined ? 1 : Number(stepPart);
    if (!Number.isInteger(step) || step < 1) {
      throw fieldError(bounds, field, "step must be a positive integer");
    }
    let lo = bounds.min;
    let hi = bounds.max;
    if (rangePart !== "*") {
      const range = rangePart.split("-");
      if (range.length > 2 || range.some((part) => !/^\d+$/.test(part))) {
        throw fieldError(bounds, field, "expected a number, range or *");
      }
      lo = Number(range[0]);
      hi = range.length === 2 ? Number(range[1]!) : stepPart === undefined ? lo : bounds.max;
      if (lo < bounds.min || hi > bounds.max || lo > hi) {
        throw fieldError(bounds, field, `values must be within ${bounds.min}-${bounds.max}`);
      }
    }
    for (let value = lo; value <= hi; value += step) {
      // 0 and 7 both denote Sunday; store the normalized form.
      const normalized =
        bounds.label === "day-of-week" && value === 7 ? 0 : value;
      values.add(normalized);
    }
  }
  if (values.size === 0) {
    throw fieldError(bounds, field, "no values matched");
  }
  return values;
}

function fieldError(bounds: FieldBounds, field: string, reason: string): Error {
  return invalidInput(`invalid cron ${bounds.label} field: ${reason}`, {
    field: bounds.label,
    value: field,
  });
}

/**
 * Earliest occurrence strictly after `after`, or null when no day matches
 * within the search bound (e.g. `0 0 30 2 *`).
 */
export function nextCronOccurrence(
  cron: CronExpression,
  timezone: string,
  after: Date,
): Date | null {
  if (!isValidIanaTimeZone(timezone)) {
    throw invalidInput("unknown IANA time zone", { timezone });
  }
  const start = wallClockInZone(timezone, after);
  for (let dayOffset = 0; dayOffset < MAX_SEARCH_DAYS; dayOffset += 1) {
    const day = addDays(start.year, start.month, start.day, dayOffset);
    if (!dayMatches(cron, day)) {
      continue;
    }
    const found = earliestOccurrenceInDay(cron, timezone, day, after);
    if (found !== null) {
      return found;
    }
  }
  return null;
}

interface WallDate {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

function addDays(year: number, month: number, day: number, offset: number): WallDate {
  const shifted = new Date(Date.UTC(year, month - 1, day + offset));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

function dayMatches(cron: CronExpression, day: WallDate): boolean {
  if (!cron.months.has(day.month)) {
    return false;
  }
  if (!cron.domRestricted && !cron.dowRestricted) {
    return true;
  }
  const weekday = new Date(Date.UTC(day.year, day.month - 1, day.day)).getUTCDay();
  if (cron.domRestricted && cron.dowRestricted) {
    return cron.daysOfMonth.has(day.day) || cron.daysOfWeek.has(weekday);
  }
  return cron.domRestricted
    ? cron.daysOfMonth.has(day.day)
    : cron.daysOfWeek.has(weekday);
}

/**
 * Earliest valid instant > after among the day's matching wall minutes.
 * Wall minutes are scanned in order; the first minute whose earliest
 * instant is in the future wins outright (later minutes start later). A
 * minute whose first instant is in the past but whose overlap second pass
 * is in the future records a candidate and keeps scanning, because a later
 * minute's first pass can still be earlier than that second pass.
 */
function earliestOccurrenceInDay(
  cron: CronExpression,
  timezone: string,
  day: WallDate,
  after: Date,
): Date | null {
  let fallback: Date | null = null;
  for (const hour of [...cron.hours].sort((a, b) => a - b)) {
    for (const minute of [...cron.minutes].sort((a, b) => a - b)) {
      const instants = wallMinuteToInstants(timezone, day, hour, minute);
      if (instants.length === 0) {
        continue;
      }
      if (instants[0]!.getTime() > after.getTime()) {
        return instants[0]!;
      }
      const second = instants[1];
      if (
        second !== undefined &&
        second.getTime() > after.getTime() &&
        (fallback === null || second.getTime() < fallback.getTime())
      ) {
        fallback = second;
      }
    }
  }
  return fallback;
}

/**
 * UTC instants whose wall clock equals the given minute in the zone:
 * usually one, none inside a spring-forward gap, two inside a fall-back
 * overlap. Offsets are probed a day on either side of the naive time so
 * both DST regimes adjacent to the minute are considered.
 */
function wallMinuteToInstants(
  timezone: string,
  day: WallDate,
  hour: number,
  minute: number,
): Date[] {
  const naive = Date.UTC(day.year, day.month - 1, day.day, hour, minute, 0, 0);
  const offsets = new Set<number>();
  for (const probe of [naive - DAY_MS, naive, naive + DAY_MS]) {
    offsets.add(offsetAtMs(timezone, new Date(probe)));
  }
  const wallEquals = (instant: Date): boolean => {
    const parts = wallClockInZone(timezone, instant);
    return (
      parts.year === day.year &&
      parts.month === day.month &&
      parts.day === day.day &&
      parts.hour === hour &&
      parts.minute === minute &&
      parts.second === 0
    );
  };
  const instants = new Map<number, Date>();
  for (const offset of offsets) {
    const instant = new Date(naive - offset);
    if (wallEquals(instant)) {
      instants.set(instant.getTime(), instant);
    }
  }
  return [...instants.values()].sort((a, b) => a.getTime() - b.getTime());
}

interface WallClock extends WallDate {
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timezone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timezone);
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
    formatters.set(timezone, formatter);
  }
  return formatter;
}

function wallClockInZone(timezone: string, instant: Date): WallClock {
  const parts = formatterFor(timezone).formatToParts(instant);
  const values = new Map<string, number>();
  for (const part of parts) {
    if (part.type !== "literal") {
      values.set(part.type, Number(part.value));
    }
  }
  return {
    year: values.get("year")!,
    month: values.get("month")!,
    day: values.get("day")!,
    hour: values.get("hour")!,
    minute: values.get("minute")!,
    second: values.get("second")!,
  };
}

/** Offset (wall − UTC) in ms at the instant, via a wall-clock round trip. */
function offsetAtMs(timezone: string, instant: Date): number {
  const parts = wallClockInZone(timezone, instant);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return asUtc - instant.getTime() + instant.getUTCMilliseconds();
}
