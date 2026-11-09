import { describe, expect, it } from "vitest";
import { MemoryAuditSink } from "./audit.js";
import { ToolGateway, ToolRegistry } from "./gateway.js";
import { bindSkillTools } from "./skill-tools.js";
import { ToolRejectionError } from "./types.js";

const BOT = "22222222-2222-4222-8222-222222222222";

describe("learn_skill", () => {
  it("refuses a bot id in the arguments and a caller with no bot", async () => {
    const registry = new ToolRegistry();
    for (const tool of bindSkillTools({
      learn(_botId, input) {
        return { created: true, skill: { id: "s", name: input.name, version: 1 } };
      },
      list() {
        return [];
      },
    })) {
      registry.register(tool);
    }
    const gateway = new ToolGateway({
      registry,
      audit: new MemoryAuditSink(),
      grants: { check: async () => ({ allowed: true }) },
    });
    await expect(
      gateway.call({ id: "chat:s", botId: BOT }, "learn_skill", {
        name: "周报",
        instructions: "三段",
        botId: BOT,
      }),
    ).rejects.toBeInstanceOf(ToolRejectionError);
    await expect(
      gateway.call({ id: "chat:s" }, "learn_skill", { name: "周报", instructions: "三段" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED_PATH" });
  });
});
