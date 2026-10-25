/**
 * Event stream consumption state (D09 brief §2.1 events/).
 *
 * Delivery is at-least-once (CONTRACTS §4): consumers deduplicate by
 * eventId/sequence. `sequence` is strictly increasing within one Run, so a
 * known sequence arriving under any id is a redelivery and an event beyond
 * `lastSequence + 1` means loss. Missing events are NEVER guessed or
 * backfilled: a gap switches the stream to `snapshotRequired` so the UI
 * rebuilds from a `run.get` snapshot instead of pretending to be complete
 * (transient `assistant.delta` chunks are separate — no persistent
 * sequence, never replayed here).
 */
import type { EventEnvelope } from "@deepseek-bot/contracts";

export type SubscribeResponse = {
  events: EventEnvelope[];
  snapshotRequired: boolean;
};

export type EventStreamState = {
  runId: string;
  /** Ordered accepted events; sequence strictly increasing. */
  events: EventEnvelope[];
  /** Highest accepted sequence; null until the first event lands. */
  lastSequence: number | null;
  duplicatesDropped: number;
  /** Detected loss window (exclusive bounds of the missing range). */
  gap: { missingFrom: number; missingTo: number } | null;
  /** Needs a snapshot rebuild (host said so or a gap was detected). */
  snapshotRequired: boolean;
  /** Times the stream was rebuilt from a snapshot. */
  rebuildCount: number;
};

export type ApplyResult = {
  state: EventStreamState;
  /** Events accepted in this batch, in order. */
  accepted: EventEnvelope[];
  /** Redeliveries dropped in this batch (eventId or sequence already seen). */
  duplicates: number;
  gapDetected: boolean;
};

export function initEventStream(runId: string): EventStreamState {
  return {
    runId,
    events: [],
    lastSequence: null,
    duplicatesDropped: 0,
    gap: null,
    snapshotRequired: false,
    rebuildCount: 0,
  };
}

function accept(state: EventStreamState, event: EventEnvelope): EventStreamState {
  return {
    ...state,
    events: [...state.events, event],
    lastSequence: event.sequence,
  };
}

/**
 * Merge one delivery batch. Rules (in order):
 * 1. known eventId  → duplicate (at-least-once redelivery), drop;
 * 2. sequence ≤ lastSequence → duplicate, drop (sequences never replay);
 * 3. sequence > lastSequence + 1 → gap: drop, mark snapshotRequired
 *    (no fake backfill — the view must rebuild from a snapshot);
 * 4. exactly lastSequence + 1 (or first event) → accept.
 */
export function applyEvents(
  state: EventStreamState,
  incoming: readonly EventEnvelope[],
): ApplyResult {
  let next = state;
  const accepted: EventEnvelope[] = [];
  let duplicates = 0;
  let gapDetected = false;

  for (const event of incoming) {
    if (event.runId !== state.runId) {
      // Foreign-run envelopes are a service bug, not data loss; treat as a
      // duplicate-class drop so counters surface it in tests.
      duplicates += 1;
      next = { ...next, duplicatesDropped: next.duplicatesDropped + 1 };
      continue;
    }
    if (next.events.some((seen) => seen.eventId === event.eventId)) {
      duplicates += 1;
      next = { ...next, duplicatesDropped: next.duplicatesDropped + 1 };
      continue;
    }
    if (
      next.lastSequence !== null &&
      event.sequence <= next.lastSequence
    ) {
      duplicates += 1;
      next = { ...next, duplicatesDropped: next.duplicatesDropped + 1 };
      continue;
    }
    if (
      next.lastSequence !== null &&
      event.sequence > next.lastSequence + 1
    ) {
      gapDetected = true;
      next = {
        ...next,
        gap: {
          missingFrom: next.lastSequence + 1,
          missingTo: event.sequence - 1,
        },
        snapshotRequired: true,
      };
      continue;
    }
    next = accept(next, event);
    accepted.push(event);
  }

  next =
    duplicates > 0
      ? { ...next, duplicatesDropped: next.duplicatesDropped }
      : next;

  return { state: next, accepted, duplicates, gapDetected };
}

/** Apply an events.subscribe response; the host flag latches until rebuild. */
export function applySubscribeResult(
  state: EventStreamState,
  response: SubscribeResponse,
): ApplyResult {
  const merged = applyEvents(state, response.events);
  const snapshotRequired =
    merged.state.snapshotRequired || response.snapshotRequired;
  return {
    ...merged,
    state: { ...merged.state, snapshotRequired },
  };
}

/**
 * Rebuild from a snapshot: drop the partial stream (its events are already
 * reflected in the snapshot) and keep counting rebuilds. The caller then
 * re-subscribes; only events newer than the snapshot are folded in.
 */
export function rebuildFromSnapshot(state: EventStreamState): EventStreamState {
  return {
    ...state,
    events: [],
    lastSequence: null,
    gap: null,
    snapshotRequired: false,
    rebuildCount: state.rebuildCount + 1,
  };
}

/**
 * Fixture-only reconnect helper (crash-reconnect.json interaction 1): the
 * consumer had processed through `sequence` before the connection dropped;
 * everything after it is forgotten so the next subscribe replays the tail.
 */
export function resumeFrom(
  state: EventStreamState,
  sequence: number,
): EventStreamState {
  const events = state.events.filter((event) => event.sequence <= sequence);
  return {
    ...state,
    events,
    lastSequence: events.length > 0 ? sequence : null,
    gap: null,
    snapshotRequired: false,
  };
}
