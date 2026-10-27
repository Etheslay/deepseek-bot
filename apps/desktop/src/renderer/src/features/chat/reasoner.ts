/**
 * Deep-thinking toggle helper (GAP_AUDIT G5).
 *
 * The Host seeds two built-in model profiles (packages/host/src/host.ts):
 * deepseek-chat (default) and deepseek-reasoner. The chat-header switch moves
 * a bot between them through the existing human path — bot.update with
 * patch.modelProfileId — so the choice persists with the bot configuration
 * and restarts keep it. Zero contract change; the model cannot flip the
 * switch itself (no update_bot tool exists in the gateway).
 *
 * The UUIDs mirror the host's DEFAULT_MODEL_PROFILE_ID and
 * REASONER_MODEL_PROFILE_ID constants; the host seeding test pins both rows,
 * so a drift fails there instead of surfacing as a mysterious toggle failure.
 */

export const CHAT_MODEL_PROFILE_ID = "44444444-4444-4444-8444-444444444444";
export const REASONER_MODEL_PROFILE_ID = "8d5a5e30-0000-4000-8000-000000000005";

export function isDeepThinkingEnabled(modelProfileId: string): boolean {
  return modelProfileId === REASONER_MODEL_PROFILE_ID;
}

export function deepThinkingTargetId(enabled: boolean): string {
  return enabled ? REASONER_MODEL_PROFILE_ID : CHAT_MODEL_PROFILE_ID;
}
