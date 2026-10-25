import { describe, expect, it } from "vitest";
import { validateBotDraft } from "../../src/renderer/src/features/bots/bot-form.js";

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
