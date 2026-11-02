/**
 * Vision capability flags (B3'' 视觉输入, TASK_B3P_VISION_INPUT.md; plan 乙
 * of open-defects §2.1).
 *
 * `vision.status` mirrors the voice.status capability-availability pattern.
 * The local pinned catalog is the ADMISSION list for image blocks, not a
 * claim about upstream authority:
 * - cataloged vision (`deepseek-flash` — the pinned @deepseek-ai/dsh
 *   0.2.1-rc.2 snapshot's only image-input model): both flags true; image
 *   blocks ride the turn and the upstream still gates per real capability;
 * - cataloged text-only (`deepseek-chat` / `deepseek-reasoner` — the Host's
 *   seeded profiles): `visionKnown=true, visionAvailable=false`; the UI
 *   says "cannot see images" and no blocks are attached;
 * - anything else: `visionKnown=false, visionAvailable=false`; the UI says
 *   "vision capability not registered; blocks not attached this turn".
 * Image attachments land in the workspace in every case, so
 * `read_workspace_file` keeps working and nothing is silently dropped.
 */
import { EngineError } from "@deepseek-bot/runtime";
import type { OpenedDatabase } from "@deepseek-bot/storage";
import { getBot, getModelProfile } from "@deepseek-bot/storage";

/** Pinned @deepseek-ai/dsh 0.2.1-rc.2 DEFAULT_MODELS ids with image input. */
const VISION_MODEL_IDS = new Set(["deepseek-flash"]);
/** Pinned catalog ids known to be text-only (the Host's seeded profiles). */
const TEXT_ONLY_MODEL_IDS = new Set(["deepseek-chat", "deepseek-reasoner"]);

export interface VisionCapability {
  readonly model: string;
  readonly visionAvailable: boolean;
  readonly visionKnown: boolean;
}

function invalidEngineError(message: string): EngineError {
  return new EngineError({ code: "INVALID_INPUT", message, retryable: false });
}

export function visionCapabilityFor(db: OpenedDatabase, botId: string): VisionCapability {
  const bot = getBot(db, botId);
  if (bot === undefined) {
    throw invalidEngineError(`bot '${botId}' was not found`);
  }
  const profile = getModelProfile(db, bot.modelProfileId);
  if (profile === undefined) {
    throw invalidEngineError(`model profile '${bot.modelProfileId}' was not found`);
  }
  const model = profile.model;
  if (VISION_MODEL_IDS.has(model)) {
    return { model, visionKnown: true, visionAvailable: true };
  }
  if (TEXT_ONLY_MODEL_IDS.has(model)) {
    return { model, visionKnown: true, visionAvailable: false };
  }
  // Outside the pinned catalog: not registered — distinct from "known to be
  // unable", which is what the text-only row above reports.
  return { model, visionKnown: false, visionAvailable: false };
}
