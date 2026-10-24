/**
 * Stable error codes and the error object (docs/CONTRACTS.md §6).
 *
 * Error details must be sanitized by the producer before they are attached:
 * no credentials, no full environment variables, no unsanitized request
 * payloads. Backend stack traces go to local diagnostic logs only.
 */
import { z } from "zod";
import { UuidSchema } from "./primitives.js";

export const ERROR_CODES = [
  "INVALID_INPUT",
  "WORKFLOW_CYCLE",
  "MISSING_BINDING",
  "REVISION_CONFLICT",
  "UNAUTHORIZED_PATH",
  "APPROVAL_REQUIRED",
  "APPROVAL_EXPIRED",
  "AUTH_FAILED",
  "RATE_LIMITED",
  "MODEL_UNAVAILABLE",
  "RUNTIME_UNAVAILABLE",
  "TOOL_TIMEOUT",
  "CANCELLED",
  "DISK_FULL",
  "DATA_VERSION_UNSUPPORTED",
  "BUDGET_EXCEEDED",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export const ErrorCodeSchema = z.enum(ERROR_CODES);

export const ErrorDetailsSchema = z.record(z.string(), z.unknown());

export const ContractErrorSchema = z.object({
  code: ErrorCodeSchema,
  message: z.string().min(1).max(2_000),
  retryable: z.boolean(),
  requestId: UuidSchema,
  details: ErrorDetailsSchema.optional(),
});

export type ContractError = z.infer<typeof ContractErrorSchema>;

/** Non-retryable classes per CONTRACTS.md §5 (schema errors, auth, permissions). */
export const NON_RETRYABLE_BY_DEFAULT: readonly ErrorCode[] = [
  "INVALID_INPUT",
  "WORKFLOW_CYCLE",
  "MISSING_BINDING",
  "REVISION_CONFLICT",
  "UNAUTHORIZED_PATH",
  "APPROVAL_REQUIRED",
  "APPROVAL_EXPIRED",
  "AUTH_FAILED",
  "DATA_VERSION_UNSUPPORTED",
  "BUDGET_EXCEEDED",
  "CANCELLED",
];
