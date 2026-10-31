import { describe, expect, it } from "vitest";
import {
  mergeToneInstructions,
  parseToneSelection,
  TONE_PRESETS,
  MINIMAL_TONE_IDS,
  NORMAL_TONE_ID,
  stripToneSuffix,
  toneSuffix,
  validateBotDraft,
} from "../../src/renderer/src/features/bots/bot-form.js";

const VALID = {
  name: "review-bot",
  instructions: "You review deliverables.",
  modelProfileId: "44444444-4444-4444-8444-444444444444",
  workspaceId: "55555555-5555-4555-8555-555555555555",
  toolPolicyId: "66666666-6666-4666-8666-666666666666",
};

describe("validateBotDraft (BotSchema field positioning)", () => {
  it("accepts a valid draft", () => {
    expect(validateBotDraft(VALID)).toEqual({});
  });

  it("rejects an empty name and points at the name field", () => {
    const errors = validateBotDraft({ ...VALID, name: "" });
    expect(errors.name).toBeDefined();
    expect(Object.keys(errors)).toEqual(["name"]);
  });

  it("rejects a non-uuid modelProfileId and points at that field", () => {
    const errors = validateBotDraft({ ...VALID, modelProfileId: "not-a-uuid" });
    expect(errors.modelProfileId).toBeDefined();
  });

  it("rejects instructions beyond the contract limit (100_000)", () => {
    const errors = validateBotDraft({ ...VALID, instructions: "x".repeat(100_001) });
    expect(errors.instructions).toBeDefined();
  });

  it("collects every invalid field at once (empty instructions is legal)", () => {
    const errors = validateBotDraft({
      name: "",
      instructions: "",
      modelProfileId: "",
      workspaceId: "",
      toolPolicyId: "",
    });
    expect(Object.keys(errors).sort()).toEqual([
      "modelProfileId",
      "name",
      "toolPolicyId",
      "workspaceId",
    ]);
  });
});

describe("tone presets and the instruction suffix", () => {
  it("ships a normal default that every create dialog shows", () => {
    const normal = TONE_PRESETS.find((tone) => tone.id === NORMAL_TONE_ID);
    expect(normal).toBeDefined();
    expect(normal!.instruction.length).toBeGreaterThan(4);
    expect(MINIMAL_TONE_IDS.has(NORMAL_TONE_ID)).toBe(true);
  });

  it("appends one suffix from the resolved phrases", () => {
    expect(mergeToneInstructions("You review deliverables.", ["傲娇", "幽默"])).toBe(
      "You review deliverables.（语气：傲娇、幽默）",
    );
    expect(toneSuffix([])).toBe("");
    expect(mergeToneInstructions("You review deliverables.", [])).toBe(
      "You review deliverables.",
    );
  });

  it("replaces the stored suffix instead of accumulating (edit safety)", () => {
    const stored = "整理资料（语气：可爱、温柔）";
    expect(mergeToneInstructions(stored, ["傲娇"])).toBe("整理资料（语气：傲娇）");
    // Unchecking every chip removes the suffix entirely.
    expect(mergeToneInstructions(stored, [])).toBe("整理资料");
    expect(stripToneSuffix("（语气：可爱）")).toBe("");
  });

  it("parses the stored suffix back onto chips, custom text included", () => {
    const parsed = parseToneSelection("整理资料（语气：傲娇、神秘、幽默）");
    expect(parsed.ids).toEqual(["tsundere", "humorous"]);
    expect(parsed.custom).toBe("神秘");
    expect(parseToneSelection("no suffix here")).toEqual({ ids: [], custom: null });
  });
});
