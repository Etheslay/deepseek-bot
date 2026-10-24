import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isSequenceMonotonic } from "./index.js";

/**
 * D01 real Harness samples (docs/fixtures/d01). These are not project-contract
 * events; they anchor the mapping claims made in docs/fixtures/d01/README.md:
 * persisted `seq` is strictly monotonic and survives restarts, the vocabulary
 * matches the documented set, and tool/interrupt provenance fields exist.
 */
const D01_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "docs",
  "fixtures",
  "d01",
);

const SAMPLES = [
  { file: "tool-run-session.jsonl", eventCount: 34 },
  { file: "interrupt-resume-session.jsonl", eventCount: 29 },
] as const;

const DOCUMENTED_VOCABULARY = new Set([
  "session",
  "permission/preset",
  "sandbox/mode",
  "approval/policy",
  "agent/inbox/spliced",
  "turn/start",
  "turn/end",
  "step/start",
  "step/end",
  "system/message",
  "user/message",
  "assistant/message",
  "request/header",
  "request/context",
  "tool/call",
  "tool/result",
  "session/title",
  "session/title-llm-request",
  "session-log-deepseek/delivery-accepted",
  "session/end-seed",
]);

type SampleEvent = {
  type: string;
  seq?: number;
  cwd?: string;
  data?: Record<string, unknown>;
};

function readSample(file: string): SampleEvent[] {
  const content = readFileSync(path.join(D01_DIR, file), "utf-8");
  return content
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as SampleEvent);
}

describe("D01 real Harness samples", () => {
  it("lead with a session header line that carries no seq", () => {
    for (const sample of SAMPLES) {
      const events = readSample(sample.file);
      expect(events).toHaveLength(sample.eventCount);
      const header = events[0];
      expect(header?.type).toBe("session");
      expect(header?.seq).toBeUndefined();
      expect(typeof header?.cwd).toBe("string");
    }
  });

  it("persist strictly monotonic sequence values starting at zero", () => {
    for (const sample of SAMPLES) {
      const events = readSample(sample.file);
      const withSeq = events.filter(
        (event): event is SampleEvent & { seq: number } =>
          typeof event.seq === "number",
      );
      expect(withSeq.length).toBe(sample.eventCount - 1);
      expect(withSeq[0]?.seq).toBe(0);
      expect(
        isSequenceMonotonic(withSeq.map((event) => ({ sequence: event.seq }))),
      ).toBe(true);
    }
  });

  it("stay within the documented event vocabulary", () => {
    for (const sample of SAMPLES) {
      const events = readSample(sample.file);
      for (const event of events) {
        expect(
          DOCUMENTED_VOCABULARY.has(event.type),
          `undocumented event type in ${sample.file}: ${event.type}`,
        ).toBe(true);
      }
    }
  });

  it("record tool provenance fields the contract maps to artifacts", () => {
    const events = readSample("tool-run-session.jsonl");
    const results = events.filter((event) => event.type === "tool/result");
    expect(results.length).toBeGreaterThan(0);
    for (const result of results) {
      expect(Array.isArray((result as { sourceEventSeqs?: unknown }).sourceEventSeqs)).toBe(true);
      const data = result.data as {
        message?: { isError?: boolean };
        meta?: { operation?: string; path?: string };
      };
      expect(typeof data.message?.isError).toBe("boolean");
      expect(typeof data.meta?.path).toBe("string");
    }
  });

  it("mark interrupted turns for the recovery flow", () => {
    const events = readSample("interrupt-resume-session.jsonl");
    const turnEnds = events.filter((event) => event.type === "turn/end");
    const reasons = turnEnds.map(
      (event) =>
        (event.data as { reason?: { kind?: string } }).reason?.kind ?? null,
    );
    expect(reasons).toContain("interrupted");
    expect(reasons).toContain("completed");
    expect(
      events.some((event) => event.type === "session/end-seed"),
    ).toBe(true);
  });
});
