/**
 * Skill library persistence (docs/CONTRACTS.md, protocol v0.11).
 *
 * The D17 skill library (named, versioned instruction blocks plus per-bot
 * bindings) moves from renderer localStorage to Host storage. These two
 * trusted desktop methods are the only validated write path: the library is
 * stored and returned whole, so the renderer keeps its pure library helpers
 * and the Host owns durability (restart, backup/restore, multi-window).
 *
 * Injection is NOT part of this surface: `chat.send.skills` (protocol 0.8+,
 * PR #115) stays the only injection path, and the tool gateway keeps
 * rejecting tools outside the declared capability set before authorization.
 * Stored `capabilities` are plain strings on purpose — the library keeps
 * unknown legacy ids so old exports still load; enforcement happens when a
 * send is composed, not when the library is stored.
 */
import { z } from "zod";
import { NonEmptyStringSchema, TEXT_LIMITS, UuidSchema } from "./primitives.js";

/** Total skills one library may hold (mirrors the renderer MAX_SKILLS = 30). */
export const MAX_LIBRARY_SKILLS = 30;
/** Per-skill stored instruction bound (wider than the 4 000-char send cap). */
export const MAX_SKILL_INSTRUCTIONS = 20_000;
/** Bots one library may carry bindings for. */
export const MAX_SKILL_BINDINGS = 50;

export const SkillDefinitionSchema = z.object({
  id: NonEmptyStringSchema(64),
  name: NonEmptyStringSchema(TEXT_LIMITS.name),
  description: z.string().max(500).optional(),
  instructions: NonEmptyStringSchema(MAX_SKILL_INSTRUCTIONS),
  capabilities: z.array(z.string().min(1).max(64)).max(64),
  version: z.int().min(1).max(1_000_000),
  /** Epoch milliseconds, matching the renderer's Date.now() stamps. */
  createdAt: z.int().min(0),
  updatedAt: z.int().min(0),
});

export const SkillLibrarySchema = z
  .object({
    skills: z.array(SkillDefinitionSchema).max(MAX_LIBRARY_SKILLS),
    bindings: z
      .record(UuidSchema, z.array(UuidSchema).max(30))
      .refine((bindings) => Object.keys(bindings).length <= MAX_SKILL_BINDINGS, {
        message: `at most ${MAX_SKILL_BINDINGS} bound bots`,
      })
      .refine(
        (bindings) =>
          Object.values(bindings).every(
            (ids) => new Set(ids).size === ids.length,
          ),
        { message: "binding ids must be unique" },
      ),
  });

export type SkillDefinition = z.infer<typeof SkillDefinitionSchema>;
export type SkillLibrary = z.infer<typeof SkillLibrarySchema>;

export const EMPTY_SKILL_LIBRARY: SkillLibrary = { skills: [], bindings: {} };

export const SKILL_LIBRARY_METHODS = {
  /**
   * Read the persisted library. The Host answers with a schema-valid library
   * (empty when nothing is stored yet); a corrupt row degrades to empty
   * instead of failing the call.
   */
  "skillLibrary.get": {
    request: z.object({}).strict(),
    response: z.object({ library: SkillLibrarySchema }),
  },
  /**
   * Replace the whole library atomically. The request schema validates the
   * full shape (limits, bindings, instruction bounds) before anything is
   * written; the response echoes the stored library. Last write wins, which
   * matches the previous localStorage semantics.
   */
  "skillLibrary.save": {
    request: z.object({ library: SkillLibrarySchema }).strict(),
    response: z.object({ library: SkillLibrarySchema }),
  },
} as const;
