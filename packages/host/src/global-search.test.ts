/**
 * D25 host-side global search at the contract surface: one query over the
 * seeded corpora returns contract-shaped hits; LIKE wildcards stay literal;
 * the method stays a trusted desktop surface with no model tool.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { appendChatMessage, insertArtifactVersion } from "@deepseek-bot/storage";
import { createHost, DEFAULT_MODEL_PROFILE_ID, type DeepSeekBotHost } from "./host.js";

const roots: string[] = [];
const hosts: DeepSeekBotHost[] = [];
afterAll(async () => {
  for (const host of hosts.splice(0)) {
    await host.shutdown().catch(() => undefined);
  }
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

async function makeHost(): Promise<DeepSeekBotHost> {
  const root = mkdtempSync(join(tmpdir(), "dsb-host-gsearch-"));
  roots.push(root);
  const host = await createHost({
    dataRoot: root,
    resolveApiKey: async () => "test-key",
  });
  hosts.push(host);
  return host;
}

async function seedBot(host: DeepSeekBotHost, name: string): Promise<string> {
  const policy = host.db.raw.prepare("SELECT id FROM tool_policies LIMIT 1;").get() as {
    id: string;
  };
  const ws = host.db.raw.prepare("SELECT id FROM workspaces LIMIT 1;").get() as { id: string };
  const bot = (await host.handleMethod("bot.create", {
    name,
    instructions: "x",
    modelProfileId: DEFAULT_MODEL_PROFILE_ID,
    workspaceId: ws.id,
    toolPolicyId: policy.id,
  })) as { id: string };
  return bot.id;
}

function insertWorkflowRow(host: DeepSeekBotHost, name: string): string {
  const id = randomUUID();
  const now = host.db.now().toISOString();
  host.db.raw
    .prepare(
      "INSERT INTO workflows (id, revision, name, schema_version, nodes_json, edges_json, limits_json, created_at, updated_at) " +
        "VALUES (?, ?, ?, '0.1', '[]', '[]', '{}', ?, ?);",
    )
    .run(id, randomUUID(), name, now, now);
  return id;
}

describe("search.global handler", () => {
  it("fans one query out over bots, messages, workflows and artifacts", async () => {
    const host = await makeHost();
    const botId = await seedBot(host, "季度报告助手");
    const filler = "填充".repeat(220);
    appendChatMessage(host.db, {
      botId,
      sessionId: `chat:${botId}`,
      role: "user",
      text: `${filler} 请整理季度报告 ${filler}`,
    });
    insertWorkflowRow(host, "季度报告流程");
    insertArtifactVersion(host.db, {
      id: randomUUID(),
      botId,
      relativePath: "reports/季度报告.md",
      revision: 1,
      author: "user",
      mediaType: "text/markdown",
      size: 16,
      checksumValue: "a".repeat(64),
      contentPath: join(host.layout.root, "artifact.md"),
    });

    const response = (await host.handleMethod("search.global", { query: "季度报告" })) as {
      results: Array<{ kind: string; id: string; botId: string | null; title: string; snippet: string | null }>;
    };
    const kinds = response.results.map((hit) => hit.kind).sort();
    expect(kinds).toEqual(["artifact", "bot", "message", "workflow"]);
    const message = response.results.find((hit) => hit.kind === "message");
    expect(message?.botId).toBe(botId);
    expect(message?.title).toBe("季度报告助手");
    expect(message?.snippet).toContain("季度报告");
    expect(message?.snippet?.startsWith("…")).toBe(true);
    expect(message?.snippet?.endsWith("…")).toBe(true);
    expect(message?.snippet?.length).toBeLessThanOrEqual(400);
    const artifact = response.results.find((hit) => hit.kind === "artifact");
    expect(artifact?.title).toBe("reports/季度报告.md");
    const bot = response.results.find((hit) => hit.kind === "bot");
    expect(bot?.id).toBe(botId);
    const workflow = response.results.find((hit) => hit.kind === "workflow");
    expect(workflow?.botId).toBeNull();
  });

  it("keeps LIKE wildcards literal at the handler boundary", async () => {
    const host = await makeHost();
    const botId = await seedBot(host, "esc-bot");
    appendChatMessage(host.db, {
      botId,
      sessionId: `chat:${botId}`,
      role: "user",
      text: "进度 100% 完成",
    });
    const hit = (await host.handleMethod("search.global", { query: "100%" })) as {
      results: Array<{ kind: string; snippet: string | null }>;
    };
    expect(hit.results).toHaveLength(1);
    expect(hit.results[0]?.snippet).toContain("100% 完成");
    const none = (await host.handleMethod("search.global", { query: "_" })) as {
      results: Array<unknown>;
    };
    expect(none.results).toHaveLength(0);
  });

  it("caps per-kind results by limit", async () => {
    const host = await makeHost();
    const botId = await seedBot(host, "many-bot");
    for (let index = 0; index < 8; index += 1) {
      appendChatMessage(host.db, {
        botId,
        sessionId: `chat:${botId}`,
        role: "user",
        text: `重复检索词 ${index}`,
      });
    }
    const capped = (await host.handleMethod("search.global", { query: "检索词", limit: 3 })) as {
      results: Array<{ kind: string }>;
    };
    expect(capped.results.filter((hit) => hit.kind === "message")).toHaveLength(3);
  });

  it("stays out of the model tool registry", async () => {
    const host = await makeHost();
    const names = host.agentTools.capabilities.list().map((entry) => entry.name);
    expect(names).not.toContain("global_search");
    for (const name of names) {
      expect(name.startsWith("search")).toBe(false);
    }
  });
});
