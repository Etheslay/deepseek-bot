/**
 * Shared helpers for repository modules: JSON column codec with contract
 * validation, and explicit transactions around node:sqlite.
 */
import type { DatabaseSync } from "node:sqlite";
import type { z } from "zod";
import { invalidInput } from "../errors.js";

export function stringifyJson(value: unknown): string {
  return JSON.stringify(value);
}

/** Parse a JSON column and validate it against a contract schema. */
export function parseJsonColumn<T>(
  schema: z.ZodType<T>,
  raw: string,
  context: string,
): T {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw invalidInput(`stored ${context} is not valid JSON`);
  }
  const result = schema.safeParse(value);
  if (!result.success) {
    throw invalidInput(`stored ${context} does not match its contract schema`, {
      context,
      issues: result.error.issues.map((issue) => ({
        path: issue.path.join("."),
        code: issue.code,
      })),
    });
  }
  return result.data;
}

export function runInTransaction<T>(raw: DatabaseSync, fn: () => T): T {
  raw.exec("BEGIN IMMEDIATE;");
  try {
    const result = fn();
    raw.exec("COMMIT;");
    return result;
  } catch (error) {
    try {
      raw.exec("ROLLBACK;");
    } catch {
      // The failed statement may have auto-rolled-back; nothing to do.
    }
    throw error;
  }
}

export function isoNow(now: () => Date): string {
  return now().toISOString();
}

/**
 * Map a SQLite constraint failure to a contract error. Foreign keys are
 * pre-checked by repos for precise messages; this is the safety net.
 */
export function constraintError(error: unknown, action: string): never {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("FOREIGN KEY constraint failed")) {
    throw invalidInput(`${action}: referenced entity does not exist`);
  }
  if (message.includes("UNIQUE constraint failed")) {
    throw invalidInput(`${action}: duplicate value for a unique field`);
  }
  throw error;
}
