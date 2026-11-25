/**
 * Context meter end-to-end (TASK_CONTEXT_METER.md): the percentage gauge,
 * the ≥80% background compression that folds older history into a summary
 * while keeping every chat_messages row, and the next prompt's digest block.
 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import type { ContextUsageResult } from "./handlers.js";
import { createHost, type DeepSeekBotHost } from "./host.js";
import { appendChatMessage, createBot, listChatMessages, upsertChatSummary } from "@deepseek-bot/storage";
import { CONTEXT_WINDOW_ENV_VAR } from "./context-window.js";

const fakeHarness = fileURLToPath(
  new URL("../../harness-adapter/src/testing/fake-harness.mjs", import.meta.url),
);
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

afterEach(() => {
  // Window resolution reads the env at call time; never leak it across tests.
  delete process.env[CONTEXT_WINDOW_ENV_VAR];
});

/**
 * The "ok" fake answers a fixed short reply, so a compression turn produces
 * a genuinely shorter digest — the percentage visibly drops after the fold.
 * Each message is ~900 CJK chars plus a distinct tail (≈905 tokens under the
 * weighted estimator), so history crosses the 8k test window within a few
 * turns while every row stays identifiable.
 *
 * The 8k denominator rides the debug env override (DSB_CONTEXT_WINDOW_TOKENS),
 * which outranks MODEL_CONTEXT_WINDOWS — the fixture bot's deepseek-chat would
 * otherwise resolve to its documented 128k window.
 */
async function meterHost(
  scenario = "ok",
  envWindowTokens: string | null = "8000",
): Promise<{ host: DeepSeekBotHost; botId: string }> {
  if (envWindowTokens === null) {
    delete process.env[CONTEXT_WINDOW_ENV_VAR];
  } else {
    process.env[CONTEXT_WINDOW_ENV_VAR] = envWindowTokens;
  }
  const root = mkdtempSync(join(tmpdir(), "dsb-context-meter-"));
  roots.push(root);
  const host = await createHost({
    dataRoot: root,
    resolveApiKey: async () => "sk-test-only",
    dshBin: fakeHarness,
    childEnv: (parent) => ({ ...parent, FAKE_SCENARIO: scenario }),
  });
  hosts.push(host);
  const now = host.db.now().toISOString();
  const ref = `cred:${randomUUID()}`;
  host.db.raw
    .prepare("INSERT INTO credentials (ref, label, created_at, updated_at) VALUES (?, 't', ?, ?);")
    .run(ref, now, now);
  const profileId = randomUUID();
  host.db.raw
    .prepare(
      "INSERT INTO model_profiles (id, provider, model, endpoint, credential_ref, limits_json, created_at, updated_at) " +
        "VALUES (?, 'deepseek', 'deepseek-chat', 'https://api.deepseek.com', ?, '{}', ?, ?);",
    )
    .run(profileId, ref, now, now);
  const workspaceId = randomUUID();
  host.db.raw
    .prepare(
      "INSERT INTO workspaces (id, canonical_path, grants_json, created_at, updated_at) VALUES (?, ?, '[]', ?, ?);",
    )
    .run(workspaceId, join(root, "ws"), now, now);
  mkdirSync(join(root, "ws"), { recursive: true });
  const policyId = randomUUID();
  host.db.raw
    .prepare(
      "INSERT INTO tool_policies (id, revision, name, policy_json, created_at, updated_at) VALUES (?, ?, 't', ?, ?, ?);",
    )
    .run(
      policyId,
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
  const bot = createBot(host.db, {
    bot: {
      id: randomUUID(),
      revision: randomUUID(),
      name: "meter-bot",
      instructions: "be brief",
      modelProfileId: profileId,
      workspaceId,
      toolPolicyId: policyId,
      role: "standard",
      archivedAt: null,
    },
  });
  return { host, botId: bot.bot.id };
}

async function usageOf(host: DeepSeekBotHost, botId: string): Promise<ContextUsageResult> {
  return (await host.handleMethod("chat.contextUsage", { botId })) as unknown as ContextUsageResult;
}

describe("context meter (TASK_CONTEXT_METER.md)", () => {
  it("reports an empty gauge before any turn", async () => {
    const { host, botId } = await meterHost();
    const usage = await usageOf(host, botId);
    expect(usage).toMatchObject({
      percent: 0,
      usedTokens: 0,
      windowTokens: 8_000,
      estimated: true,
      compressedAt: null,
      compressing: false,
    });
  });

  it("compresses at ≥80%, keeps every row, and the next prompt folds the digest", async () => {
    const { host, botId } = await meterHost();

    let compressed = false;
    let sawPreFoldRows = false;
    let rowsBeforeFold = 0;
    for (let turn = 1; turn <= 10; turn += 1) {
      await host.handleMethod("chat.send", {
        botId,
        text: `${"长".repeat(900)}第${turn}条`,
      });
      const usage = await usageOf(host, botId);
      if (usage.compressedAt !== null) {
        // The background fold already finished between the reply and this read:
        // no pre-fold count exists for this race, so the equality check below
        // does not apply (the floor assertion still holds).
        compressed = true;
        break;
      }
      // The fold for this trigger has not completed yet, so this snapshot is
      // a genuine pre-fold row count.
      rowsBeforeFold = listChatMessages(host.db, botId, 100).length;
      sawPreFoldRows = true;
      if (usage.percent >= 80) {
        // The fold runs in the background right after this turn.
        await vi.waitFor(
          async () => {
            const current = await usageOf(host, botId);
            expect(current.compressedAt).not.toBeNull();
            expect(current.compressing).toBe(false);
          },
          { timeout: 10_000, interval: 100 },
        );
        compressed = true;
        break;
      }
    }
    expect(compressed).toBe(true);

    // The percentage refreshed immediately after the fold: the summarized
    // prompt (short digest + newest turn + headroom) sits well below the
    // trigger that fired at ≥80%.
    const after = await usageOf(host, botId);
    expect(after.estimated).toBe(true);
    expect(after.percent).toBeLessThan(80);
    expect(after.compressedAt).not.toBeNull();

    // Storage keeps every row — the fold never deletes history. The weighted
    // CJK token estimate makes compression fire earlier than the old
    // chars/4 rule, so how many turns (and rows) accumulate before the fold
    // is no longer a fixed value; this assertion therefore pins the
    // semantics only: the row count survives the fold unchanged.
    const rows = listChatMessages(host.db, botId, 100);
    expect(rows.length).toBeGreaterThanOrEqual(2); // at least one Q&A turn
    if (sawPreFoldRows) {
      expect(rows.length).toBe(rowsBeforeFold); // the fold deletes nothing
    }
  });

  it("folds the digest into the next prompt and replays only post-watermark rows", async () => {
    // echo-model replies with the whole composed prompt, so the reply itself
    // proves the prompt shape; the summary is seeded directly to keep this
    // test about composition, not about the threshold.
    const { host, botId } = await meterHost("echo-model");
    await host.handleMethod("chat.send", { botId, text: "第1条" });
    await host.handleMethod("chat.send", { botId, text: "第2条" });
    const rows = listChatMessages(host.db, botId, 10);
    // Watermark after the FIRST turn: turn 2's pair stays verbatim replay.
    const watermark = rows[1]?.id ?? "";
    upsertChatSummary(host.db, {
      botId,
      sessionId: `chat:${botId}`,
      summary: "早期要点：结论 X 已定，任务 Y 待办。",
      coversMessageId: watermark,
    });

    const next = (await host.handleMethod("chat.send", { botId, text: "压缩后的一问" })) as {
      text: string;
    };
    expect(next.text).toContain("【更早对话摘要】");
    expect(next.text).toContain("结论 X 已定");
    expect(next.text.indexOf("【更早对话摘要】")).toBeLessThan(
      next.text.indexOf("【最近对话】"),
    );
    // Only the post-watermark rows replay verbatim: the replay section opens
    // with turn 2's user line (turn 1 lives in the digest now), and the
    // current message rides as [用户消息]. (The echo replies embed earlier
    // prompts, so content-substring checks would be ambiguous by design.)
    const replay = next.text.split("【最近对话】")[1] ?? "";
    expect(replay.trimStart().startsWith("用户：第2条")).toBe(true);
    expect(next.text.includes("[用户消息]\n压缩后的一问")).toBe(true);
  });

  it("replays the newest turns that fit and leaves an oversized older turn out", async () => {
    const { host, botId } = await meterHost("echo-model");
    const sessionId = `chat:${botId}`;
    appendChatMessage(host.db, {
      botId,
      sessionId,
      role: "user",
      text: `旧开头${"旧".repeat(8_000)}`,
    });
    appendChatMessage(host.db, { botId, sessionId, role: "assistant", text: "旧回复" });
    appendChatMessage(host.db, { botId, sessionId, role: "user", text: "新结尾标记" });
    appendChatMessage(host.db, { botId, sessionId, role: "assistant", text: "新回复" });
    const next = (await host.handleMethod("chat.send", { botId, text: "现在问" })) as { text: string };
    expect(next.text).toContain("新结尾标记");
    expect(next.text).not.toContain("旧开头");
  });

  it("drops rows a summary already covers when the watermark is outside the oldest window", async () => {
    const { host, botId } = await meterHost("echo-model");
    const sessionId = `chat:${botId}`;
    const covered = appendChatMessage(host.db, {
      botId,
      sessionId,
      role: "user",
      text: "不应出现的旧句",
    });
    for (let index = 1; index <= 30; index += 1) {
      appendChatMessage(host.db, {
        botId,
        sessionId,
        role: index % 2 === 0 ? "assistant" : "user",
        text: `填充${index}`,
      });
    }
    const newest = appendChatMessage(host.db, {
      botId,
      sessionId,
      role: "user",
      text: "应当出现的新句",
    });
    upsertChatSummary(host.db, {
      botId,
      sessionId,
      summary: "摘要锚点乙",
      coversMessageId: covered.id,
    });
    const next = (await host.handleMethod("chat.send", { botId, text: "现在问" })) as { text: string };
    expect(next.text).toContain("摘要锚点乙");
    expect(next.text).toContain(newest.text);
    expect(next.text).not.toContain("不应出现的旧句");
  });

  it("leaves sessions below the threshold untouched", async () => {
    const { host, botId } = await meterHost();
    await host.handleMethod("chat.send", { botId, text: "小消息" });
    await host.handleMethod("chat.send", { botId, text: "又一条小消息" });
    const usage = await usageOf(host, botId);
    expect(usage.percent).toBeLessThan(80);
    expect(usage.compressedAt).toBeNull();
    expect(usage.compressing).toBe(false);
  });
});

describe("per-model context windows", () => {
  /** A second bot whose profile carries an arbitrary model name. */
  function botWithModel(host: DeepSeekBotHost, model: string): string {
    const now = host.db.now().toISOString();
    const ref = `cred:${randomUUID()}`;
    host.db.raw
      .prepare("INSERT INTO credentials (ref, label, created_at, updated_at) VALUES (?, 't', ?, ?);")
      .run(ref, now, now);
    const profileId = randomUUID();
    host.db.raw
      .prepare(
        "INSERT INTO model_profiles (id, provider, model, endpoint, credential_ref, limits_json, created_at, updated_at) " +
          "VALUES (?, 'deepseek', ?, 'https://api.deepseek.com', ?, '{}', ?, ?);",
      )
      .run(profileId, model, ref, now, now);
    const bot = createBot(host.db, {
      bot: {
        id: randomUUID(),
        revision: randomUUID(),
        name: `model-${model}`,
        instructions: "be brief",
        modelProfileId: profileId,
        workspaceId: "55555555-5555-4555-8555-555555555555",
        toolPolicyId: "66666666-6666-4666-8666-666666666666",
        role: "standard",
        archivedAt: null,
      },
    });
    return bot.bot.id;
  }

  it("resolves the documented window for a deepseek-chat bot", async () => {
    const { host, botId } = await meterHost("ok", null);
    const usage = await usageOf(host, botId);
    expect(usage.windowTokens).toBe(128_000);
    expect(Number.isFinite(usage.percent)).toBe(true);
    expect(usage.percent).toBe(0);
  });

  it("lets the debug env value outrank the model table", async () => {
    const { host, botId } = await meterHost("ok", "200000");
    const usage = await usageOf(host, botId);
    expect(usage.windowTokens).toBe(200_000);
  });

  it("ignores invalid env values and falls through to the model table", async () => {
    for (const raw of ["abc", "0", "-1", "9999999"]) {
      const { host, botId } = await meterHost("ok", raw);
      const usage = await usageOf(host, botId);
      expect(usage.windowTokens).toBe(128_000);
      expect(Number.isFinite(usage.percent)).toBe(true);
      expect(usage.percent).toBe(0);
    }
  });

  it("falls back to 65_536 with a sane gauge for an unknown model", async () => {
    const { host } = await meterHost("ok", null);
    const unknownBotId = botWithModel(host, "deepseek-foo");
    const usage = await usageOf(host, unknownBotId);
    expect(usage.windowTokens).toBe(65_536);
    expect(Number.isFinite(usage.percent)).toBe(true);
    expect(usage.percent).toBe(0);
  });
});
