import { describe, expect, it } from "vitest";
import { MemoryAuditSink } from "./audit.js";
import { ToolGateway, ToolRegistry } from "./gateway.js";
import { bindScheduleTools, type BotMessageScheduleStore } from "./schedule-tools.js";
import { ToolRejectionError } from "./types.js";

const BOT = "22222222-2222-4222-8222-222222222222";

function store(): BotMessageScheduleStore & { saved: unknown[] } {
  const saved: unknown[] = [];
  return {
    saved,
    save(_botId, input) {
      saved.push(input);
      return {
        created: true,
        schedule: {
          id: "12121212-1212-4121-8121-121212121212",
          message: input.message,
          hour: input.hour,
          minute: input.minute,
          days: input.days,
          timezone: "America/Los_Angeles",
          clock: "17:00",
          nextRunAt: "2026-11-10T01:00:00.000Z",
        },
      };
    },
    list() {
      return [];
    },
    cancel() {
      return { cancelled: true };
    },
  };
}

describe("schedule_message", () => {
  it("saves for the calling bot and refuses a bot id in the arguments", async () => {
    const schedules = store();
    const registry = new ToolRegistry();
    for (const tool of bindScheduleTools(schedules)) registry.register(tool);
    const gateway = new ToolGateway({
      registry,
      audit: new MemoryAuditSink(),
      grants: { check: async () => ({ allowed: true }) },
    });
    const saved = await gateway.call({ id: "chat:s", botId: BOT }, "schedule_message", {
      message: "你好",
      hour: 17,
    });
    expect(saved).toMatchObject({ created: true, schedule: { clock: "17:00", days: "every" } });
    expect(schedules.saved).toEqual([{ message: "你好", hour: 17, minute: 0, days: "every" }]);
    await expect(
      gateway.call({ id: "chat:s", botId: BOT }, "schedule_message", {
        message: "你好",
        hour: 5,
        botId: BOT,
      }),
    ).rejects.toBeInstanceOf(ToolRejectionError);
    await expect(
      gateway.call({ id: "chat:s" }, "schedule_message", { message: "你好", hour: 5 }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED_PATH" });
  });
});
