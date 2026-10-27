/**
 * Contract validation helpers (D05 brief §2.1 services).
 *
 * Every service-layer input/output is validated here with the executable
 * schemas from `@deepseek-bot/contracts`; components never hand-roll type
 * assertions. Nothing in this file duplicates a contracts type.
 */
import {
  ArtifactSchema,
  ArtifactVersionSchema,
  BotArtifactSchema,
  BotSchema,
  EventEnvelopeSchema,
  ModelProfileSchema,
  isWithinMessageSizeLimit,
  type Artifact,
  type ArtifactVersion,
  type Bot,
  type BotArtifact,
  type EventEnvelope,
  type ModelProfile,
} from "@deepseek-bot/contracts";

export type ContractIssue = { path: string[]; message: string };

export type ContractResult<T> =
  | { ok: true; value: T }
  | { ok: false; issues: ContractIssue[] };

type SafeParseLike = (
  value: unknown,
) =>
  | { success: true; data: unknown }
  | { success: false; error: { issues: { path: PropertyKey[]; message: string }[] } };

function parse<T>(schema: SafeParseLike, value: unknown): ContractResult<T> {
  const result = schema(value);
  if (result.success) {
    return { ok: true, value: result.data as T };
  }
  return {
    ok: false,
    issues: result.error.issues.map((issue) => ({
      path: issue.path.map((segment) => String(segment)),
      message: issue.message,
    })),
  };
}

export const validateBot = (value: unknown): ContractResult<Bot> =>
  parse<Bot>(BotSchema.safeParse.bind(BotSchema), value);

export const validateModelProfile = (value: unknown): ContractResult<ModelProfile> =>
  parse<ModelProfile>(ModelProfileSchema.safeParse.bind(ModelProfileSchema), value);

export const validateArtifact = (value: unknown): ContractResult<Artifact> =>
  parse<Artifact>(ArtifactSchema.safeParse.bind(ArtifactSchema), value);

export const validateBotArtifact = (value: unknown): ContractResult<BotArtifact> =>
  parse<BotArtifact>(BotArtifactSchema.safeParse.bind(BotArtifactSchema), value);

export const validateArtifactVersion = (value: unknown): ContractResult<ArtifactVersion> =>
  parse<ArtifactVersion>(ArtifactVersionSchema.safeParse.bind(ArtifactVersionSchema), value);

export const validateEventEnvelope = (value: unknown): ContractResult<EventEnvelope> =>
  parse<EventEnvelope>(EventEnvelopeSchema.safeParse.bind(EventEnvelopeSchema), value);

/** 1 MiB single-message cap from the method boundary contract. */
export const withinMessageLimit = (value: unknown): boolean =>
  isWithinMessageSizeLimit(value);
