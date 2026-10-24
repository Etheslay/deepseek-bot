import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { appendEvent, listEvents, maxEventSequence, StorageError } from "./index.js";
import {
  createRun,
} from "./repos/runs.js";
import {
  makeEvent,
  makeLayout,
  makeRun,
  makeTempRoot,
  makeWorkflow,
  openTestDatabase,
} from "./test-support.js";

describe("event repository", () => {
  it("appends events with strictly increasing per-run sequences", () => {
    const db = openTestDatabase(makeLayout(makeTempRoot()));
    const run = createRun(db, makeRun(makeWorkflow())).run;
    expect(appendEvent(db, makeEvent(run.id, 0)).recorded).toBe(true);
    expect(appendEvent(db, makeEvent(run.id, 1)).recorded).toBe(true);
    expect(maxEventSequence(db, run.id)).toBe(1);

    try {
      appendEvent(db, makeEvent(run.id, 1, { eventId: randomUUID() }));
      expect.fail("expected duplicate sequence rejection");
    } catch (error) {
      expect((error as StorageError).code).toBe("INVALID_INPUT");
      expect((error as StorageError).details["expectedSequence"]).toBe(2);
    }
    db.close();
  });

  it("deduplicates redelivery by eventId without advancing the sequence", () => {
    const db = openTestDatabase(makeLayout(makeTempRoot()));
    const run = createRun(db, makeRun(makeWorkflow())).run;
    const event = makeEvent(run.id, 0);
    expect(appendEvent(db, event).recorded).toBe(true);
    const redelivered = appendEvent(db, event);
    expect(redelivered.recorded).toBe(false);
    expect(redelivered.sequence).toBe(0);
    expect(listEvents(db, run.id)).toHaveLength(1);
    db.close();
  });

  it("validates payloads against the per-type contract schemas", () => {
    const db = openTestDatabase(makeLayout(makeTempRoot()));
    const run = createRun(db, makeRun(makeWorkflow())).run;
    // Terminal run.statusChanged without a reason must be rejected.
    try {
      appendEvent(db, makeEvent(run.id, 0, {
        type: "run.statusChanged",
        payload: { from: "running", to: "succeeded" },
      }));
      expect.fail("expected payload rejection");
    } catch (error) {
      expect((error as StorageError).code).toBe("INVALID_INPUT");
    }
    db.close();
  });

  it("replays events after a sequence for crash reconnection", () => {
    const db = openTestDatabase(makeLayout(makeTempRoot()));
    const run = createRun(db, makeRun(makeWorkflow())).run;
    for (let sequence = 0; sequence < 5; sequence += 1) {
      appendEvent(db, makeEvent(run.id, sequence));
    }
    const replayed = listEvents(db, run.id, { afterSequence: 2 });
    expect(replayed.map((event) => event.sequence)).toEqual([3, 4]);
    expect(listEvents(db, run.id, { afterSequence: 4 })).toEqual([]);
    expect(listEvents(db, run.id).at(-1)?.sequence).toBe(4);
    db.close();
  });

  it("refuses events for unknown runs", () => {
    const db = openTestDatabase(makeLayout(makeTempRoot()));
    expect(() => appendEvent(db, makeEvent(randomUUID(), 0))).toThrow(/run does not exist/);
    db.close();
  });
});

describe("event listing bounds", () => {
  it("applies the limit option", () => {
    const db = openTestDatabase(makeLayout(makeTempRoot()));
    const run = createRun(db, makeRun(makeWorkflow())).run;
    for (let sequence = 0; sequence < 4; sequence += 1) {
      appendEvent(db, makeEvent(run.id, sequence));
    }
    expect(listEvents(db, run.id, { limit: 2 }).map((event) => event.sequence)).toEqual([0, 1]);
    db.close();
  });
});
