import { describe, expect, it } from "vitest";
import { MAX_CHAT_SKILL_INSTRUCTIONS } from "@deepseek-bot/contracts";
import { capabilitiesConsumedBy } from "./agent-permissions.js";
import { composeSkillBlock, skillCapabilityAllowlist } from "./skill-injection.js";

describe("composeSkillBlock", () => {
  it("returns an empty string when the turn has no skills", () => {
    expect(composeSkillBlock([])).toBe("");
  });

  it("fences the instructions and outgrows backticks inside them", () => {
    const block = composeSkillBlock([
      { name: "周报", version: 2, instructions: "只写三段。", capabilities: [] },
      { name: "围栏", version: 1, instructions: "```ts\nconst a = 1;\n```", capabilities: [] },
    ]);
    expect(block).toContain("已为该 bot 启用 2 个技能");
    expect(block.indexOf("周报")).toBeLessThan(block.indexOf("围栏"));
    expect(block).toContain("````");
    expect(block.endsWith("````")).toBe(true);
  });

  it("caps the combined instructions", () => {
    const block = composeSkillBlock([
      {
        name: "长",
        version: 1,
        instructions: "长".repeat(MAX_CHAT_SKILL_INSTRUCTIONS + 50),
        capabilities: ["fs.read"],
      },
    ]);
    expect(block).toContain("…（技能上下文已截断）");
    expect(block.length).toBeLessThan(MAX_CHAT_SKILL_INSTRUCTIONS + 200);
  });
});

describe("skill capability allowlist", () => {
  it("stays unset until a skill declares a capability id", () => {
    expect(skillCapabilityAllowlist([])).toBeUndefined();
    expect(
      skillCapabilityAllowlist([
        { name: "a", version: 1, instructions: "a", capabilities: [] },
      ]),
    ).toBeUndefined();
    expect(
      skillCapabilityAllowlist([
        { name: "a", version: 1, instructions: "a", capabilities: ["fs.read"] },
        { name: "b", version: 1, instructions: "b", capabilities: ["fs.read", "memory.read"] },
      ]),
    ).toEqual(["fs.read", "memory.read"]);
  });

  it("maps batch creation and an unknown tool", () => {
    expect(capabilitiesConsumedBy("create_bots_batch", {})).toEqual(["app.create_bot"]);
    expect(capabilitiesConsumedBy("create_bots_batch", { newGroup: { name: "g" } })).toEqual([
      "app.create_bot",
      "app.create_group",
    ]);
    expect(capabilitiesConsumedBy("read_workspace_file", { path: "a.md" })).toEqual(["fs.read"]);
    expect(capabilitiesConsumedBy("not_a_tool", {})).toBeUndefined();
  });
});
