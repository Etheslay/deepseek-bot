import { describe, expect, it } from "vitest";
import { appendChatMessage, listChatMessages, saveBotMessageSchedule } from "@deepseek-bot/storage";
import { BotMessageScheduler } from "./scheduler/bot-messages.js";
import { insertBot, makeBot, openTestDatabase, seedProfileAndWorkspace } from "./test-support.js";

const DUE = "2026-11-09T17:00:00.000Z";
const NOW = "2026-11-09T17:00:20.000Z";

describe("bot message scheduler", () => {
  it("posts the saved text once and skips a late occurrence", () => {
    const db = openTestDatabase();
    const bot = makeBot(seedProfileAndWorkspace(db));
    insertBot(db, bot);
    const sent: string[] = [];
    const scheduler = new BotMessageScheduler({
      db,
      now: () => new Date(NOW),
      deliver(schedule) {
        sent.push(schedule.message);
        appendChatMessage(db, {
          botId: schedule.botId,
          sessionId: `chat:${schedule.botId}`,
          role: "assistant",
          text: schedule.message,
        });
      },
    });
    const saved = saveBotMessageSchedule(db, {
      botId: bot.id,
      message: "你好",
      timezone: "UTC",
      recurrence: "0 17 * * *",
      hour: 17,
      minute: 0,
      days: "every",
      nextRunAt: DUE,
    });
    expect(scheduler.tick()).toEqual([
      { scheduleId: saved.schedule.id, occurrenceUtc: DUE, outcome: "triggered" },
    ]);
    expect(sent).toEqual(["你好"]);
    expect(listChatMessages(db, bot.id).map((row) => row.text)).toEqual(["你好"]);
    expect(scheduler.tick()).toEqual([]);
    expect(listChatMessages(db, bot.id)).toHaveLength(1);

    db.raw
      .prepare("UPDATE bot_message_schedules SET next_run_at = ? WHERE id = ?;")
      .run(DUE, saved.schedule.id);
    expect(scheduler.tick()[0]?.outcome).toBe("duplicate");
    expect(listChatMessages(db, bot.id)).toHaveLength(1);

    const missed = saveBotMessageSchedule(db, {
      botId: bot.id,
      message: "晚点",
      timezone: "UTC",
      recurrence: "0 16 * * *",
      hour: 16,
      minute: 0,
      days: "every",
      nextRunAt: "2026-11-09T16:00:00.000Z",
    });
    expect(scheduler.tick().find((row) => row.scheduleId === missed.schedule.id)?.outcome).toBe(
      "missed",
    );
    expect(listChatMessages(db, bot.id).map((row) => row.text)).toEqual(["你好"]);
    db.close();
  });
});
