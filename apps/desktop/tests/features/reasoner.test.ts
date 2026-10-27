/**
 * Deep-thinking toggle helper (GAP_AUDIT G5): pure-function coverage for the
 * profile-id mapping. The host-side seeding contract is pinned in
 * packages/host (host.test.ts GAP_AUDIT G5 case).
 */
import { describe, expect, it } from "vitest";
import {
  CHAT_MODEL_PROFILE_ID,
  REASONER_MODEL_PROFILE_ID,
  deepThinkingTargetId,
  isDeepThinkingEnabled,
} from "../../src/renderer/src/features/chat/reasoner.js";

describe("deep-thinking toggle mapping (G5)", () => {
  it("treats only the reasoner profile as enabled", () => {
    expect(isDeepThinkingEnabled(REASONER_MODEL_PROFILE_ID)).toBe(true);
    expect(isDeepThinkingEnabled(CHAT_MODEL_PROFILE_ID)).toBe(false);
    expect(isDeepThinkingEnabled("00000000-0000-4000-8000-000000000000")).toBe(false);
  });

  it("maps the switch target to the matching built-in profile", () => {
    expect(deepThinkingTargetId(true)).toBe(REASONER_MODEL_PROFILE_ID);
    expect(deepThinkingTargetId(false)).toBe(CHAT_MODEL_PROFILE_ID);
  });

  it("round-trips a switch on and back off", () => {
    const enabled = deepThinkingTargetId(true);
    expect(isDeepThinkingEnabled(enabled)).toBe(true);
    expect(isDeepThinkingEnabled(deepThinkingTargetId(false))).toBe(false);
  });

  it("keeps the mirrored UUIDs lowercase and well-formed", () => {
    for (const id of [CHAT_MODEL_PROFILE_ID, REASONER_MODEL_PROFILE_ID]) {
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    }
    expect(CHAT_MODEL_PROFILE_ID).not.toBe(REASONER_MODEL_PROFILE_ID);
  });
});
