import { describe, expect, it } from "vitest";
import { bindFindGithubSkillTool } from "./github-skill-tool.js";
import type { ToolContext } from "./types.js";

const BOT = "22222222-2222-4222-8222-222222222222";

function context(signal?: AbortSignal): ToolContext {
  return { caller: { id: "chat:s", botId: BOT }, ...(signal === undefined ? {} : { signal }) };
}

describe("find_github_skill", () => {
  it("returns a saved skill without asking the finder to search again", async () => {
    const signal = new AbortController().signal;
    let seen: AbortSignal | undefined;
    const tool = bindFindGithubSkillTool({
      find(query, incoming) {
        seen = incoming;
        return {
          name: "pptx",
          url: "https://example.test/skill",
          instructions: "use the brief",
          ...(query === "cached" ? { cached: true } : {}),
        };
      },
    });
    const fresh = await tool.handler({ query: "pptx" }, context(signal));
    expect(seen).toBe(signal);
    const cached = await tool.handler({ query: "cached" }, context());
    expect(fresh).toMatchObject({ name: "pptx", next: expect.stringContaining("Saved for next time") });
    expect(cached).toMatchObject({ cached: true, next: expect.stringContaining("already saved") });
  });

  it("rejects a caller with no bot and a finder that fails", async () => {
    let calls = 0;
    const tool = bindFindGithubSkillTool({
      find() {
        calls += 1;
        if (calls === 1) throw "offline";
        throw new Error("rate");
      },
    });
    await expect(tool.handler({}, { caller: { id: "chat:s" } })).rejects.toMatchObject({
      code: "UNAUTHORIZED_PATH",
    });
    await expect(tool.handler({}, context())).rejects.toMatchObject({
      code: "RUNTIME_UNAVAILABLE",
      message: "GitHub skill search failed",
    });
    await expect(tool.handler({}, context())).rejects.toMatchObject({ message: "rate" });
  });
});
