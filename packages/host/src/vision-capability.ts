/**
 * Vision capability flag (B3'' 视觉输入, TASK_B3P_VISION_INPUT.md).
 *
 * `vision.status` mirrors the voice.status capability-availability pattern:
 * the UI asks whether the bot's configured model is KNOWN to accept image
 * input before promising anything. The catalog below is the pinned upstream
 * DEFAULT_MODELS snapshot at @deepseek-ai/dsh 0.2.1-rc.2 (deepseek-flash
 * declares `inputModalities: ["text", "image"]`, deepseek-v4-pro is
 * text-only) — upstream deployments may replace it, which is exactly what
 * `visionKnown: false` reports: the UI stays neutral, and the harness's
 * per-model gating at send time remains the authority. A text-only route
 * gets the deterministic text projection upstream — pixels are either
 * delivered or announced, never silently dropped.
 */
import { EngineError } from "@deepseek-bot/runtime";
import type { OpenedDatabase } from "@deepseek-bot/storage";
import { getBot, getModelProfile } from "@deepseek-bot/storage";

/** Pinned @deepseek-ai/dsh 0.2.1-rc.2 DEFAULT_MODELS ids with image input. */
const VISION_MODEL_IDS = new Set(["deepseek-flash"]);

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
  const known = VISION_MODEL_IDS.has(model);
  return {
    model,
    visionKnown: known,
    visionAvailable: known,
  };
}
