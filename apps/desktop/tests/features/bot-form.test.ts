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

  it("writes one strong persona directive per preset — a bare word would not survive the model", () => {
    for (const tone of TONE_PRESETS) {
      expect(tone.instruction.length).toBeGreaterThan(8);
      expect(tone.word.length).toBeGreaterThan(0);
      expect(tone.instruction).not.toMatch(/[（）]/);
    }
    // 呆萌可爱 must be fully spelled out: reactions, catchphrases, pacing,
    // and the promise that the answer still lands.
    const adorkable = TONE_PRESETS.find((tone) => tone.id === "adorkable")!;
    expect(adorkable.instruction).toContain("呆萌");
    expect(adorkable.instruction).toContain("慢半拍");
    expect(adorkable.instruction).toContain("诶诶");
    expect(adorkable.instruction).toContain("呆是萌的一部分");
  });

  it("appends one suffix from the single resolved phrase", () => {
    const adorkable = TONE_PRESETS.find((tone) => tone.id === "adorkable")!;
    expect(mergeToneInstructions("You review deliverables.", [adorkable.instruction])).toBe(
      `You review deliverables.（语气：${adorkable.instruction}）`,
    );
    expect(toneSuffix([])).toBe("");
    expect(mergeToneInstructions("You review deliverables.", [])).toBe(
      "You review deliverables.",
    );
  });

  it("replaces the stored suffix instead of accumulating (edit safety)", () => {
    const cute = TONE_PRESETS.find((tone) => tone.id === "cute")!;
    const stored = `整理资料（语气：${cute.instruction}）`;
    const tsundere = TONE_PRESETS.find((tone) => tone.id === "tsundere")!;
    expect(mergeToneInstructions(stored, [tsundere.instruction])).toBe(
      `整理资料（语气：${tsundere.instruction}）`,
    );
    // Unchecking the single chip removes the suffix entirely.
    expect(mergeToneInstructions(stored, [])).toBe("整理资料");
    expect(stripToneSuffix("（语气：可爱）")).toBe("");
  });

  it("parses the stored suffix back onto the single chip", () => {
    const cute = TONE_PRESETS.find((tone) => tone.id === "cute")!;
    expect(parseToneSelection(`整理资料（语气：${cute.instruction}）`)).toEqual({
      id: "cute",
      custom: null,
    });
    expect(parseToneSelection("no suffix here")).toEqual({ id: null, custom: null });
    expect(parseToneSelection("整理资料（语气：神秘）")).toEqual({
      id: null,
      custom: "神秘",
    });
  });

  it("maps legacy bare-word suffixes to their preset and collapses legacy multi-tones to the first", () => {
    // Old multi-select stores: 呆萌、可爱 as bare words.
    expect(parseToneSelection("整理资料（语气：呆萌、可爱）")).toEqual({
      id: "adorkable",
      custom: null,
    });
    expect(parseToneSelection("整理资料（语气：温柔）")).toEqual({ id: "gentle", custom: null });
    // A legacy mix of preset words and custom text keeps the first preset.
    expect(parseToneSelection("整理资料（语气：傲娇、神秘）")).toEqual({
      id: "tsundere",
      custom: null,
    });
  });
});
