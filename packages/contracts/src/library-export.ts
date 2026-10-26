/**
 * Library export file schemas (D17, docs/superpowers/specs/2026-10-25-skill-library-design.md §3).
 *
 * This format is NOT part of the Host protocol surface: it never travels over
 * the IPC envelope and does not participate in `PROTOCOL_VERSION` negotiation.
 * It exists so skill/template library files can be validated by any consumer
 * (renderer import, future CLI tooling) against one shared definition.
 * Additive only: no entity, method or protocol version changes.
 */
import { z } from "zod";
import {
  IsoDateTimeUtcSchema,
  NonEmptyStringSchema,
  TEXT_LIMITS,
  UuidSchema,
} from "./primitives.js";

export const LIBRARY_EXPORT_FORMAT = "deepseek-bot-library" as const;
export const LIBRARY_EXPORT_FORMAT_VERSION = 1 as const;

/**
 * Mirror of the renderer-side `SkillDefinition`
 * (apps/desktop/src/renderer/src/features/skills/skills.ts).
 * `capabilities` are declared metadata only; enforcement belongs to D16 grants.
 */
export const SkillExportSchema = z.object({
  id: UuidSchema,
  name: NonEmptyStringSchema(TEXT_LIMITS.name),
  description: z.string().max(TEXT_LIMITS.reason).optional(),
  instructions: NonEmptyStringSchema(TEXT_LIMITS.instructions),
  capabilities: z.array(NonEmptyStringSchema(TEXT_LIMITS.label)),
  version: z.number().int().min(1),
  createdAt: z.number().int().min(0),
  updatedAt: z.number().int().min(0),
});
export type SkillExport = z.infer<typeof SkillExportSchema>;

/**
 * Renderer avatar snapshot carried by templates: `Avatar` in
 * apps/desktop/src/renderer/src/features/avatars/avatar-meta.ts is a union of
 * `{ kind: "mono" }` and `{ kind: "grok"; shape; color; state? }`. Contracts
 * stay renderer-agnostic, so the ids inside are plain strings rather than
 * imported renderer enums; the snapshot shape is still enforced.
 */
export const TemplateAvatarSchema = z.union([
  z.object({ kind: z.literal("mono") }),
  z.object({
    kind: z.literal("grok"),
    shape: NonEmptyStringSchema(TEXT_LIMITS.label),
    color: z.string().min(1),
    state: z.string().min(1).optional(),
  }),
]);

/**
 * Mirror of the renderer-side bot template entry. `avatarUi` holds the avatar
 * picker state captured with the bot: the chosen avatar object plus the
 * picker's shape/color indexes — numbers, deliberately not the contract
 * `Avatar` pool id, because templates keep their visual snapshot self-contained.
 */
export const TemplateExportSchema = z.object({
  name: NonEmptyStringSchema(TEXT_LIMITS.name),
  bot: z.object({
    name: NonEmptyStringSchema(TEXT_LIMITS.name),
    instructions: z.string().max(TEXT_LIMITS.instructions),
    avatarUi: z.object({
      avatar: TemplateAvatarSchema,
      shape: z.number().int().min(0),
      color: z.number().int().min(0),
    }),
  }),
});
export type TemplateExport = z.infer<typeof TemplateExportSchema>;

export const LibraryExportFileSchema = z.object({
  format: z.literal(LIBRARY_EXPORT_FORMAT),
  formatVersion: z.literal(LIBRARY_EXPORT_FORMAT_VERSION),
  exportedAt: IsoDateTimeUtcSchema,
  skills: z.array(SkillExportSchema),
  templates: z.array(TemplateExportSchema),
});
export type LibraryExportFile = z.infer<typeof LibraryExportFileSchema>;

export type ParseLibraryExportResult =
  | { ok: true; file: LibraryExportFile }
  | { ok: false; reason: string };

/**
 * Validate an already JSON-parsed value as a library export file.
 * Malformed JSON text is rejected by the caller (renderer IO layer);
 * this function owns shape/format/version validation only.
 * Unknown object keys are stripped (zod object default), which is pinned by
 * tests so future consumers can rely on it.
 */
export function parseLibraryExport(raw: unknown): ParseLibraryExportResult {
  const result = LibraryExportFileSchema.safeParse(raw);
  if (result.success) {
    return { ok: true, file: result.data };
  }
  const first = result.error.issues[0];
  const path = first?.path.join(".") || "(root)";
  return { ok: false, reason: `${path}: ${first?.message ?? "invalid"}` };
}
