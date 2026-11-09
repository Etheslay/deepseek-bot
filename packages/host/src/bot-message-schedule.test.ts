import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { listChatMessages } from "@deepseek-bot/storage";
import { createHost, type DeepSeekBotHost } from "./host.js";

const hosts: DeepSeekBotHost[] = [];
const roots: string[] = [];

afterEach(async () => {
  for (const host of hosts.splice(0)) await host.shutdown();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

async function bot(host: DeepSeekBotHost, name: string): Promise<string> {
  const created = (await host.handleMethod("bot.create", {
    name,
    instructions: "reply",
    modelProfileId: "44444444-4444-4444-8444-444444444444",
    workspaceId: "55555555-5555-4555-8555-555555555555",
    toolPolicyId: "66666666-6666-4666-8666-666666666666",
  })) as { id: string };
  return created.id;
}

describe("chat message schedules", () => {
  it("saves from the calling bot and posts the text when the clock is due", async () => {
    const root = mkdtempSync(join(tmpdir(), "dsb-chat-schedule-"));
    roots.push(root);
    const host = await createHost({ dataRoot: root, resolveApiKey: async () => "unused" });
    hosts.push(host);
    const owner = await bot(host, "greeter");
    const other = await bot(host, "other");
    const caller = { id: `chat:${owner}`, botId: owner };
    const saved = (await host.agentTools.call(caller, "schedule_message", {
      message: "你好",
      hour: 17,
      minute: 0,
      days: "every",
    })) as { created: boolean; schedule: { id: string; timezone: string; clock: string } };
    expect(saved.created).toBe(true);
    expect(saved.schedule.clock).toBe("17:00");
    expect(saved.schedule.timezone.length).toBeGreaterThan(0);
    const again = (await host.agentTools.call(caller, "schedule_message", {
      message: "你好",
      hour: 17,
      minute: 0,
      days: "every",
    })) as { created: boolean; schedule: { id: string } };
    expect(again.created).toBe(false);
    expect(again.schedule.id).toBe(saved.schedule.id);

    const due = new Date(Date.now() - 30_000).toISOString();
    host.db.raw
      .prepare("UPDATE bot_message_schedules SET next_run_at = ? WHERE id = ?;")
      .run(due, saved.schedule.id);
    expect(host.botMessageScheduler.tick()).toEqual([
      { scheduleId: saved.schedule.id, occurrenceUtc: due, outcome: "triggered" },
    ]);
    expect(listChatMessages(host.db, owner).map((row) => row.text)).toEqual(["你好"]);
    expect(host.botMessageScheduler.tick()).toEqual([]);

    expect(
      await host.agentTools.call(
        { id: `chat:${other}`, botId: other },
        "cancel_message_schedule",
        { id: saved.schedule.id },
      ),
    ).toEqual({ cancelled: false });
    expect(
      await host.agentTools.call(caller, "cancel_message_schedule", { id: saved.schedule.id }),
    ).toEqual({ cancelled: true });
    expect(await host.agentTools.call(caller, "list_message_schedules", {})).toEqual({
      schedules: [],
    });
  });
});
