/**
 * knowledge_search tool: scoped to the trusted caller's bot, read-only, and
 * audited through the gateway like every other capability.
 */
import { describe, expect, it } from "vitest";
import { MemoryAuditSink } from "./audit.js";
import { ToolGateway, ToolRegistry } from "./gateway.js";
import { bindKnowledgeTools, type KnowledgeSearchHit } from "./knowledge.js";

const owner = "11111111-1111-4111-8111-111111111111";

function setup(hits: KnowledgeSearchHit[]) {
  const audit = new MemoryAuditSink();
  const registry = new ToolRegistry();
  for (const tool of bindKnowledgeTools({
    search(botId, query, limit) {
      return hits.slice(0, limit).map((hit) => ({ ...hit, docId: `${botId}:${hit.docId}` }));
    },
  })) {
    registry.register(tool);
  }
  const gateway = new ToolGateway({
    registry,
    audit,
    grants: { check: async () => ({ allowed: true }) },
    now: () => new Date("2026-10-26T00:00:00Z"),
  });
  return { gateway, audit };
}

describe("bindKnowledgeTools", () => {
  it("returns ranked hits scoped to the caller's bot", async () => {
    const { gateway } = setup([
      { docId: "doc-1", title: "部署手册", score: 0.8, snippet: "部署流程……", at: "2026-10-26T00:00:00.000Z" },
    ]);
    const result = (await gateway.call(
      { id: "chat:s1/b1", botId: owner },
      "knowledge_search",
      { query: "部署流程", limit: 3 },
    )) as { hits: Array<{ docId: string; title: string }> };
    expect(result.hits).toMatchObject([
      { docId: `${owner}:doc-1`, title: "部署手册", score: 0.8 },
    ]);
  });

  it("rejects a caller without a trusted bot binding", async () => {
    const { gateway } = setup([]);
    await expect(
      gateway.call({ id: "ui:1" }, "knowledge_search", { query: "x" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED_PATH" });
  });

  it("applies the default limit and rejects an empty query", async () => {
    const { gateway } = setup([
      { docId: "1", title: "a", score: 0.5, snippet: "a", at: "2026-10-26T00:00:00.000Z" },
      { docId: "2", title: "b", score: 0.4, snippet: "b", at: "2026-10-26T00:00:00.000Z" },
    ]);
    const result = (await gateway.call(
      { id: "chat:s1/b1", botId: owner },
      "knowledge_search",
      { query: "x" },
    )) as { hits: unknown[] };
    expect(result.hits).toHaveLength(2);
    await expect(
      gateway.call({ id: "chat:s1/b1", botId: owner }, "knowledge_search", { query: "   " }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
});
