/**
 * Real DeepSeek office smoke. Runs only when DEEPSEEK_API_KEY is set.
 * The key stays in the process environment and is never written or logged.
 */
import { mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createHost, type DeepSeekBotHost } from "./host.js";

const REAL_KEY = process.env["DEEPSEEK_API_KEY"];
const roots: string[] = [];
const hosts: DeepSeekBotHost[] = [];

afterAll(async () => {
  for (const host of hosts.splice(0)) await host.shutdown().catch(() => undefined);
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function filesUnder(dir: string): string[] {
  const found: string[] = [];
  const walk = (current: string): void => {
    for (const name of readdirSync(current)) {
      const absolute = join(current, name);
      if (statSync(absolute).isDirectory()) walk(absolute);
      else found.push(absolute);
    }
  };
  walk(dir);
  return found;
}

describe.skipIf(REAL_KEY === undefined)("real office files", () => {
  it("writes a pptx, a docx, and a pdf without asking for unused permissions", async () => {
    const root = mkdtempSync(join(tmpdir(), "dsb-office-"));
    roots.push(root);
    const workspace = join(root, "workspace");
    const realRef = `cred:${randomUUID()}`;
    const host = await createHost({
      dataRoot: root,
      resolveApiKey: async (ref) => {
        if (ref !== realRef || REAL_KEY === undefined) throw new Error("unknown credential ref");
        return REAL_KEY;
      },
    });
    hosts.push(host);
    const now = host.db.now().toISOString();
    const profileId = randomUUID();
    const workspaceId = randomUUID();
    const toolPolicyId = randomUUID();
    host.db.raw
      .prepare("INSERT INTO credentials (ref, label, created_at, updated_at) VALUES (?, 'smoke', ?, ?);")
      .run(realRef, now, now);
    host.db.raw
      .prepare(
        "INSERT INTO model_profiles (id, provider, model, endpoint, credential_ref, limits_json, created_at, updated_at) " +
          "VALUES (?, 'deepseek', 'deepseek-chat', 'https://api.deepseek.com/v1', ?, '{\"maxTokens\":4096}', ?, ?);",
      )
      .run(profileId, realRef, now, now);
    host.db.raw
      .prepare(
        "INSERT INTO workspaces (id, canonical_path, grants_json, created_at, updated_at) VALUES (?, ?, '[]', ?, ?);",
      )
      .run(workspaceId, workspace, now, now);
    host.db.raw
      .prepare(
        "INSERT INTO tool_policies (id, revision, name, policy_json, created_at, updated_at) VALUES (?, ?, 'smoke', ?, ?, ?);",
      )
      .run(
        toolPolicyId,
        randomUUID(),
        JSON.stringify({
          filesystem: { enabled: false, operations: [] },
          shell: { mode: "disabled" },
          network: { mode: "disabled" },
          mcp: { enabled: false, requireApproval: false, servers: [] },
        }),
        now,
        now,
      );
    const bot = (await host.handleMethod("bot.create", {
      name: "文稿机器人",
      instructions: "只用本机文件工具完成用户要的那一个文件。不要派发任务，不要执行本地命令。",
      modelProfileId: profileId,
      workspaceId,
      toolPolicyId: toolPolicyId,
    })) as { id: string };

    const asked: string[] = [];
    const watch = setInterval(() => {
      void host
        .handleMethod("permission.approval.list", { botId: bot.id, status: "pending", limit: 20 })
        .then(async (listed) => {
          const approvals = (listed as { approvals: Array<{ id: string; tool: string; capabilities: string[]; actionDigest: string }> }).approvals;
          for (const approval of approvals) {
            asked.push(`${approval.tool} [${approval.capabilities.join("+")}]`);
            await host.handleMethod("permission.approval.decide", {
              approvalId: approval.id,
              expectedActionDigest: approval.actionDigest,
              decision: "denied",
            });
          }
        })
        .catch(() => undefined);
    }, 400);

    const send = async (text: string): Promise<string> => {
      const reply = (await host.handleMethod("chat.send", { botId: bot.id, text })) as { text: string };
      return reply.text;
    };

    try {
      const ppt = await send(
        "做一份两页 pptx，文件名用 认识分数.pptx。主题认识分数，受众三年级学生和家长，目标讲清比较大小。必须保留这句：1/2 大于 1/4。不要交给其他 bot。",
      );
      const word = await send("写一份很短的 Word，路径用 分数.docx，正文只有一句：一半大于四分之一。不要执行命令。");
      const pdf = await send("把一句话写成 PDF，路径用 分数.pdf，正文只有：分母相同看分子。不要执行命令。");
      const produced = filesUnder(workspace).map((file) => file.slice(workspace.length + 1));
      const notes = { ppt, word, pdf, produced, asked };
      expect(notes, JSON.stringify(notes, null, 2)).toMatchObject({
        produced: expect.arrayContaining([
          expect.stringMatching(/\.pptx$/i),
          expect.stringMatching(/\.docx$/i),
          expect.stringMatching(/\.pdf$/i),
        ]),
      });
      expect(asked, asked.join(" | ")).toEqual([]);
    } finally {
      clearInterval(watch);
    }
  }, 1_200_000);
});
