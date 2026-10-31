import { describe, expect, it } from "vitest";
import { METHOD_CONTRACTS, UiStateSchema } from "./index.js";

const botId = "11111111-1111-4111-8111-111111111111";
const groupId = "77777777-7777-4777-8777-777777777777";
const state = { botOrder: [botId], groupOrder: [groupId], selectedBotId: botId, selectedGroupId: groupId };

describe("UI state snapshot contract", () => {
  it("accepts bounded stable IDs and empty selection", () => {
    expect(UiStateSchema.safeParse(state).success).toBe(true);
    expect(UiStateSchema.safeParse({ botOrder: [], groupOrder: [], selectedBotId: null, selectedGroupId: null }).success).toBe(true);
  });
  it("rejects arbitrary keys, including credential fields", () => {
    expect(UiStateSchema.safeParse({ ...state, apiKey: "secret" }).success).toBe(false);
  });
  it("rejects invalid IDs and duplicate entries", () => {
    expect(UiStateSchema.safeParse({ ...state, botOrder: ["secret"] }).success).toBe(false);
    expect(UiStateSchema.safeParse({ ...state, groupOrder: [groupId, groupId] }).success).toBe(false);
  });
  it("rejects lists that exceed their bound", () => {
    expect(UiStateSchema.safeParse({ ...state, botOrder: Array.from({ length: 1001 }, (_, i) => `11111111-1111-4111-8111-${i.toString(16).padStart(12, "0")}`) }).success).toBe(false);
  });
  it("treats collapsedGroupIds as optional (0.13 writers stay valid)", () => {
    // 0.13 shape without the field still parses.
    expect(UiStateSchema.safeParse(state).success).toBe(true);
    expect(UiStateSchema.safeParse({ ...state, collapsedGroupIds: [groupId] }).success).toBe(true);
    expect(UiStateSchema.safeParse({ ...state, collapsedGroupIds: ["junk"] }).success).toBe(false);
  });
});

describe("ui.state methods", () => {
  it("round-trips a snapshot through get/set contracts", () => {
    const get = METHOD_CONTRACTS["ui.state.get"]!;
    const set = METHOD_CONTRACTS["ui.state.set"]!;
    expect(get.request.safeParse({}).success).toBe(true);
    expect(get.response.safeParse({ state }).success).toBe(true);
    expect(set.request.safeParse({ state }).success).toBe(true);
    expect(set.response.safeParse({ state }).success).toBe(true);
  });
  it("rejects extra fields and non-snapshot payloads", () => {
    const set = METHOD_CONTRACTS["ui.state.set"]!;
    expect(set.request.safeParse({ state, extra: 1 }).success).toBe(false);
    expect(set.request.safeParse({ state: { ...state, apiKey: "secret" } }).success).toBe(false);
    expect(set.request.safeParse({}).success).toBe(false);
  });
});
