/**
 * Shared primitive schemas (docs/CONTRACTS.md §1).
 *
 * IDs must be unpredictable UUIDs (format enforced here; randomness is a
 * generation-time property of the producer). Timestamps are UTC ISO 8601
 * with the `Z` designator; display/scheduling timezones are stored
 * separately as IANA names.
 */
import { z } from "zod";

export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const UuidSchema = z
  .string()
  .regex(UUID_PATTERN, "expected a lowercase UUID");

export const IsoDateTimeUtcSchema = z.iso.datetime({
  offset: false,
  message: "expected UTC ISO 8601 timestamp with the Z designator",
});

export function isValidIanaTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

export const IanaTimeZoneSchema = z
  .string()
  .refine(isValidIanaTimeZone, "expected an IANA time zone identifier");

/** Canonical absolute path on the host OS (Windows drive or POSIX root). */
export const AbsolutePathSchema = z
  .string()
  .min(1)
  .max(1024)
  .refine(
    (value) => /^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(value),
    "expected an absolute path",
  );

/**
 * Artifact paths are relative to the authorized artifact directory:
 * no absolute forms, no `.`/`..` segments, no empty segments.
 */
export const RelativeArtifactPathSchema = z
  .string()
  .min(1)
  .max(1024)
  .refine((value) => !/^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(value), {
    message: "artifact path must be relative to the artifact directory",
  })
  .refine(
    (value) =>
      value.split(/[\\/]/).every((segment) => segment !== "" && segment !== "." && segment !== ".."),
    { message: "artifact path must not contain empty, '.' or '..' segments" },
  );

export const Sha256HexSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/, "expected a lowercase sha-256 hex digest");

/** RFC 2045 media type (type/subtype plus optional parameters). */
export const MediaTypeSchema = z
  .string()
  .min(3)
  .max(255)
  .regex(
    /^[\w.+-]+\/[\w.+-]+(?:;\s*[\w.*+=-]+=(?:"[^"]*"|[\w.+-]+))*$/,
    "expected an RFC 2045 media type",
  );

export const NonEmptyStringSchema = (max: number) =>
  z.string().min(1).max(max);

/** Field size limits for free-text fields (documented contract limits). */
export const TEXT_LIMITS = {
  name: 200,
  instructions: 100_000,
  template: 100_000,
  label: 100,
  reason: 2_000,
  path: 1024,
  digestHex: 64,
  /** One knowledge document (D18): independent of the 4k memory note cap. */
  knowledgeText: 100_000,
  /** One whisper.cpp transcript (D27): speech output, not a stored note. */
  voiceTranscript: 4_000,
  /** One spoken-aloud text (D27): keeps one SAPI run inside the timeout. */
  voiceSpeakText: 2_000,
  /** One live assistant segment on the `chat.stream` notice (B6): a segment
   * is a settled reply-sized text, so the cap mirrors the largest free-text
   * limit instead of the 4k user-message cap. */
  streamSegment: 100_000,
} as const;
