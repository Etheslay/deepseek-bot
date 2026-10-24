import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ContractErrorSchema,
  EventEnvelopeSchema,
  METHOD_CONTRACTS,
  RequestEnvelopeSchema,
  parseEventPayload,
  parseRequest,
  validateWorkflowDraft,
  type EventEnvelope,
  type Method,
} from "./index.js";

const FIXTURES_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "fixtures",
);

type FixtureInteraction = {
  method: string;
  envelope?: Record<string, unknown>;
  expectedResponse?: unknown;
  expectedError?: Record<string, unknown>;
  expectEnvelopeRejected?: boolean;
};

type Fixture = {
  scenario: string;
  covers: string;
  notes?: string;
  interactions?: FixtureInteraction[];
  events?: unknown[];
};

function loadFixture(name: string): Fixture {
  return JSON.parse(
    readFileSync(path.join(FIXTURES_DIR, name), "utf-8"),
  ) as Fixture;
}

function asEvents(fixture: Fixture): EventEnvelope[] {
  return (fixture.events ?? []).map((raw) => raw as EventEnvelope);
}

const fixtureFiles = readdirSync(FIXTURES_DIR)
  .filter((name) => name.endsWith(".json"))
  .sort();

const REQUIRED_SCENARIOS = [
  "success-run.json",
  "rate-limited.json",
  "cancel-run.json",
  "approval-denied.json",
  "duplicate-message.json",
  "concurrent-edit.json",
  "crash-reconnect.json",
  "workflow-cycle.json",
  "path-escape.json",
  "approval-expired.json",
] as const;

describe("contract fixtures", () => {
  it("cover every scenario required by CONTRACTS §7", () => {
    for (const required of REQUIRED_SCENARIOS) {
      expect(fixtureFiles, `missing fixture: ${required}`).toContain(required);
    }
  });

  it("validate every envelope, response, error and event against schemas", () => {
    for (const file of fixtureFiles) {
      const fixture = loadFixture(file);
      for (const interaction of fixture.interactions ?? []) {
        expect(
          interaction.envelope,
          `${file}: interaction without envelope`,
        ).toBeDefined();
        const envelope = RequestEnvelopeSchema.safeParse(interaction.envelope);
        if (interaction.expectEnvelopeRejected === true) {
          expect(envelope.success, `${file}: envelope should be rejected`).toBe(
            false,
          );
          continue;
        }
        expect(
          envelope.success,
          `${file}: envelope should parse (${JSON.stringify(envelope.error?.issues ?? null)})`,
        ).toBe(true);

        if (interaction.expectedResponse !== undefined) {
          const responseSchema =
            METHOD_CONTRACTS[interaction.method as Method].response;
          const response = responseSchema.safeParse(
            interaction.expectedResponse,
          );
          expect(
            response.success,
            `${file}: response for ${interaction.method} should match the contract (${JSON.stringify(response.error?.issues ?? null)})`,
          ).toBe(true);
        }
        if (interaction.expectedError !== undefined) {
          const error = ContractErrorSchema.safeParse(
            interaction.expectedError,
          );
          expect(
            error.success,
            `${file}: error object for ${interaction.method} should match ContractError (${JSON.stringify(error.error?.issues ?? null)})`,
          ).toBe(true);
        }
      }

      const sequences: number[] = [];
      for (const raw of fixture.events ?? []) {
        const event = EventEnvelopeSchema.safeParse(raw);
        expect(
          event.success,
          `${file}: event should match EventEnvelope (${JSON.stringify(event.error?.issues ?? null)})`,
        ).toBe(true);
        if (!event.success) {
          continue;
        }
        const payload = parseEventPayload(event.data);
        expect(
          payload.success,
          `${file}: payload of ${event.data.type} should match its schema (${JSON.stringify(payload.error?.issues ?? null)})`,
        ).toBe(true);
        sequences.push(event.data.sequence);
      }
      expect(
        sequences.every(
          (value, index) => index === 0 || value > sequences[index - 1]!,
        ),
        `${file}: event sequences must strictly increase`,
      ).toBe(true);
    }
  });
});

describe("scenario semantics", () => {
  it("success-run ends in run.completed after succeeded", () => {
    const events = asEvents(loadFixture("success-run.json"));
    expect(events.at(-1)?.type).toBe("run.completed");
    const runSucceeded = events.find(
      (event) =>
        event.type === "run.statusChanged" &&
        (event.payload as { to?: string }).to === "succeeded",
    );
    expect(runSucceeded).toBeDefined();
  });

  it("rate-limited errors are retryable with retry guidance", () => {
    const fixture = loadFixture("rate-limited.json");
    const error = fixture.interactions?.[0]?.expectedError as {
      code: string;
      retryable: boolean;
      details?: { retryAfterSeconds?: number };
    };
    expect(error.code).toBe("RATE_LIMITED");
    expect(error.retryable).toBe(true);
    expect(error.details?.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("cancel-run reaches cancelled and repeated cancel returns the terminal state", () => {
    const fixture = loadFixture("cancel-run.json");
    const interactions = fixture.interactions ?? [];
    expect(interactions).toHaveLength(2);
    const first = (interactions[0]?.expectedResponse ?? {}) as {
      status: string;
    };
    const second = (interactions[1]?.expectedResponse ?? {}) as {
      status: string;
      finishedAt: string | null;
    };
    expect(first.status).toBe("cancelling");
    expect(second.status).toBe("cancelled");
    expect(second.finishedAt).not.toBeNull();
  });

  it("approval-denied fails the node and the run without executing", () => {
    const fixture = loadFixture("approval-denied.json");
    const decide = fixture.interactions?.[0];
    expect(
      (decide?.envelope?.payload as { decision?: string }).decision,
    ).toBe("denied");
    expect((decide?.expectedResponse as { status?: string }).status).toBe(
      "denied",
    );
    const events = asEvents(fixture);
    const denied = events.find((event) => event.type === "approval.resolved");
    expect((denied?.payload as { decision?: string }).decision).toBe("denied");
    const nodeFailed = events.find(
      (event) =>
        event.type === "node.statusChanged" &&
        (event.payload as { to?: string }).to === "failed",
    );
    expect(nodeFailed).toBeDefined();
    expect(events.at(-1)?.type).toBe("run.failed");
  });

  it("duplicate-message deduplicates by requestId", () => {
    const fixture = loadFixture("duplicate-message.json");
    const interactions = fixture.interactions ?? [];
    expect(interactions).toHaveLength(2);
    const first = parseRequest(interactions[0]?.envelope, "bot.create");
    const second = parseRequest(interactions[1]?.envelope, "bot.create");
    expect(first.success && second.success).toBe(true);
    if (first.success && second.success) {
      expect(first.requestId).toBe(second.requestId);
    }
    const firstBot = (interactions[0]?.expectedResponse ?? {}) as {
      id: string;
    };
    const secondBot = (interactions[1]?.expectedResponse ?? {}) as {
      id: string;
    };
    expect(secondBot.id).toBe(firstBot.id);
  });

  it("concurrent-edit surfaces REVISION_CONFLICT with the current revision", () => {
    const fixture = loadFixture("concurrent-edit.json");
    const interactions = fixture.interactions ?? [];
    const stale = interactions[1];
    const error = (stale?.expectedError ?? {}) as {
      code: string;
      retryable: boolean;
      details?: { currentRevision?: string };
    };
    expect(error.code).toBe("REVISION_CONFLICT");
    expect(error.retryable).toBe(false);
    const staleRevision = (
      stale?.envelope?.payload as { expectedRevision?: string }
    ).expectedRevision;
    expect(error.details?.currentRevision).toBeDefined();
    expect(error.details?.currentRevision).not.toBe(staleRevision);
  });

  it("crash-reconnect replays persisted events and signals snapshotRequired", () => {
    const fixture = loadFixture("crash-reconnect.json");
    const interactions = fixture.interactions ?? [];
    expect(interactions).toHaveLength(2);

    const replay = parseRequest(interactions[0]?.envelope, "events.subscribe");
    expect(replay.success).toBe(true);
    const replayResponse = interactions[0]?.expectedResponse as {
      snapshotRequired: boolean;
      events: { sequence: number }[];
    };
    expect(replayResponse.snapshotRequired).toBe(false);
    const replaySequences = replayResponse.events.map(
      (event) => event.sequence,
    );
    expect(replaySequences.every((value) => value > 3)).toBe(true);
    expect(
      replaySequences.every(
        (value, index) => index === 0 || value > replaySequences[index - 1]!,
      ),
    ).toBe(true);

    const gapResponse = interactions[1]?.expectedResponse as {
      snapshotRequired: boolean;
      events: unknown[];
    };
    expect(gapResponse.snapshotRequired).toBe(true);
    expect(gapResponse.events).toEqual([]);
  });

  it("workflow-cycle is rejected with a locatable WORKFLOW_CYCLE issue", () => {
    const fixture = loadFixture("workflow-cycle.json");
    const interaction = fixture.interactions?.[0];
    const parsed = parseRequest(interaction?.envelope, "workflow.validate");
    expect(parsed.success).toBe(true);
    if (!parsed.success) {
      return;
    }
    const issues = validateWorkflowDraft(parsed.payload.workflow);
    const expected = (interaction?.expectedResponse ?? {}) as {
      errors: { code: string }[];
    };
    expect(issues.map((issue) => issue.code)).toEqual(
      expected.errors.map((error) => error.code),
    );
    expect(issues[0]?.code).toBe("WORKFLOW_CYCLE");
    expect(issues[0]?.nodeId).toBeDefined();
  });

  it("workflow-missing-binding locates the unbound input", () => {
    const fixture = loadFixture("workflow-missing-binding.json");
    const interaction = fixture.interactions?.[0];
    const parsed = parseRequest(interaction?.envelope, "workflow.validate");
    expect(parsed.success).toBe(true);
    if (!parsed.success) {
      return;
    }
    const issues = validateWorkflowDraft(parsed.payload.workflow);
    const unbound = issues.find((issue) => issue.code === "MISSING_BINDING");
    expect(unbound?.nodeId).toBe("n2");
    expect(unbound?.field).toBe("inputBindings.topic");
  });

  it("path-escape is rejected as UNAUTHORIZED_PATH", () => {
    const fixture = loadFixture("path-escape.json");
    const error = fixture.interactions?.[0]?.expectedError as {
      code: string;
      retryable: boolean;
    };
    expect(error.code).toBe("UNAUTHORIZED_PATH");
    expect(error.retryable).toBe(false);
    const failed = asEvents(fixture).find(
      (event) => event.type === "run.failed",
    );
    expect((failed?.payload as { errorCode?: string }).errorCode).toBe(
      "UNAUTHORIZED_PATH",
    );
  });

  it("approval-expired cannot be consumed after expiry", () => {
    const fixture = loadFixture("approval-expired.json");
    const error = fixture.interactions?.[0]?.expectedError as { code: string };
    expect(error.code).toBe("APPROVAL_EXPIRED");
    const resolved = asEvents(fixture).find(
      (event) => event.type === "approval.resolved",
    );
    expect((resolved?.payload as { decision?: string }).decision).toBe(
      "expired",
    );
  });

  it("version-mismatch rejects unknown higher versions explicitly", () => {
    const fixture = loadFixture("version-mismatch.json");
    const interactions = fixture.interactions ?? [];
    expect(interactions[0]?.expectEnvelopeRejected).toBe(true);

    const imported = parseRequest(interactions[1]?.envelope, "workflow.import");
    expect(imported.success).toBe(true);
    const importResponse = interactions[1]?.expectedResponse as {
      accepted: boolean;
      errorCode?: string;
    };
    expect(importResponse.accepted).toBe(false);
    expect(importResponse.errorCode).toBe("DATA_VERSION_UNSUPPORTED");
  });
});
