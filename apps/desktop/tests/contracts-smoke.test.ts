import { BotSchema } from "@deepseek-bot/contracts";
import { describe, expect, it } from "vitest";

describe("contracts resolution smoke", () => {
  it("parses a bot", () => {
    const parsed = BotSchema.safeParse({ id: "11111111-1111-4111-8111-111111111111", revision: "22222222-2222-4222-8222-222222222222", name: "t", instructions: "i", modelProfileId: "44444444-4444-4444-8444-444444444444", workspaceId: "55555555-5555-4555-8555-555555555555", toolPolicyId: "66666666-6666-4666-8666-666666666666", archivedAt: null });
    expect(parsed.success).toBe(true);
  });
});
