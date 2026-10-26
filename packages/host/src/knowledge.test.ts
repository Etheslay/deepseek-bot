/**
 * D18 knowledge + retention handlers through the real dispatcher: bot-
 * scoped documents, hybrid search isolation, the retention round-trip and
 * the sweep-on-write behavior.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
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
  const root = mkdtempSync(join(tmpdir(), "dsb-host-knowledge-"));
  roots.push(root);
  const host = await createHost({
    dataRoot: root,
    resolveApiKey: async () => "sk-test-not-used",
  });
  hosts.push(host);
  return host;
}

interface BotRef {
  readonly id: string;
  readonly workspaceId: string;
  readonly toolPolicyId: string;
}

/** A live bot through the public surface (default policy/workspace are seeded). */
async function makeBot(host: DeepSeekBotHost, name: string): Promise<BotRef> {
  const policy = host.db.raw.prepare("SELECT id FROM tool_policies LIMIT 1;").get() as {
    id: string;
  };
  const ws = host.db.raw.prepare("SELECT id FROM workspaces LIMIT 1;").get() as {
    id: string;
  };
  const bot = (await host.handleMethod("bot.create", {
    name,
    instructions: "knowledge test bot",
    modelProfileId: DEFAULT_MODEL_PROFILE_ID,
    workspaceId: ws.id,
    toolPolicyId: policy.id,
  })) as { id: string };
  return { id: bot.id, workspaceId: ws.id, toolPolicyId: policy.id };
}

describe("D18 knowledge and retention handlers", () => {
  it("writes, lists, searches and deletes per-bot documents", async () => {
    const host = await makeHost();
    const bot = await makeBot(host, "writer");
    const other = await makeBot(host, "reader");

    const written = (await host.handleMethod("knowledge.write", {
      botId: bot.id,
      title: "部署手册",
      text: "部署流程：运行 build 命令构建产物，然后把 dist 目录发布到服务器。",
    })) as { id: string; botId: string; title: string; size: number; at: string };
    expect(written.botId).toBe(bot.id);
    expect(written.size).toBeGreaterThan(10);

    const list = (await host.handleMethod("knowledge.list", {
      botId: bot.id,
    })) as { docs: Array<{ id: string; title: string; size: number }> };
    expect(list.docs).toEqual([
      { id: written.id, botId: bot.id, title: "部署手册", size: written.size, at: written.at },
    ]);
    expect(
      (await host.handleMethod("knowledge.list", { botId: other.id })) as {
        docs: unknown[];
      },
    ).toEqual({ docs: [] });

    const search = (await host.handleMethod("knowledge.search", {
      botId: bot.id,
      query: "发布服务器",
    })) as { hits: Array<{ docId: string; title: string; score: number }> };
    expect(search.hits).toHaveLength(1);
    expect(search.hits[0]).toMatchObject({ docId: written.id, title: "部署手册" });
    expect(search.hits[0]!.score).toBeGreaterThan(0);
    // Another bot's library stays invisible.
    expect(
      (await host.handleMethod("knowledge.search", {
        botId: other.id,
        query: "发布服务器",
      })) as { hits: unknown[] },
    ).toEqual({ hits: [] });

    await host.handleMethod("knowledge.delete", { botId: bot.id, docId: written.id });
    expect(
      (await host.handleMethod("knowledge.list", { botId: bot.id })) as { docs: unknown[] },
    ).toEqual({ docs: [] });
    await expect(
      host.handleMethod("knowledge.delete", { botId: bot.id, docId: written.id }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("round-trips the retention policy and sweeps on write", async () => {
    const host = await makeHost();
    const bot = await makeBot(host, "collector");

    expect(
      (await host.handleMethod("memory.retention.get", {})) as { policy: unknown },
    ).toEqual({ policy: { retentionDays: 0, memoryMaxPerBot: 0, knowledgeMaxPerBot: 0 } });

    const policy = { retentionDays: 90, memoryMaxPerBot: 500, knowledgeMaxPerBot: 1 };
    expect(
      (await host.handleMethod("memory.retention.set", { policy })) as { policy: unknown },
    ).toEqual({ policy });
    expect(
      (await host.handleMethod("memory.retention.get", {})) as { policy: unknown },
    ).toEqual({ policy });

    // Cap of 1 knowledge doc per bot: the second write sweeps the first.
    const first = (await host.handleMethod("knowledge.write", {
      botId: bot.id,
      title: "第一份",
      text: "旧文档内容。",
    })) as { id: string };
    const second = (await host.handleMethod("knowledge.write", {
      botId: bot.id,
      title: "第二份",
      text: "新文档内容。",
    })) as { id: string };
    expect(second.id).not.toBe(first.id);
    const list = (await host.handleMethod("knowledge.list", { botId: bot.id })) as {
      docs: Array<{ id: string }>;
    };
    expect(list.docs.map((doc) => doc.id)).toEqual([second.id]);

    // Memory cap of 500 is not reached; notes survive.
    await host.handleMethod("memory.write", { botId: bot.id, text: "一条记忆" });
    expect(
      (await host.handleMethod("memory.list", { botId: bot.id })) as {
        memories: unknown[];
      },
    ).toMatchObject({ memories: [{ text: "一条记忆" }] });

    // The policy persists for the next host start (startup sweep reads it).
    expect(
      host.db.raw.prepare("SELECT value_json FROM settings WHERE key = 'memory.retention';").get(),
    ).toMatchObject({
      value_json: JSON.stringify(policy),
    });
  });
});
