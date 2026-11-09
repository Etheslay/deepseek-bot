/**
 * Chat schedules for the calling bot.
 *
 * The person defines the clock in conversation. These tools save, list and
 * cancel that bot's own message schedules. They do not open settings and
 * they do not start a workflow.
 */
import { z } from "zod";
import { UuidSchema } from "@deepseek-bot/contracts";
import { ToolRejectionError, type ToolCapability, type ToolContext } from "./types.js";

export const ScheduleMessageInputSchema = z
  .object({
    message: z.string().trim().min(1).max(2_000),
    hour: z.int().min(0).max(23),
    minute: z.int().min(0).max(59).default(0),
    days: z.enum(["every", "weekdays"]).default("every"),
  })
  .strict();

export const ListMessageSchedulesInputSchema = z.object({}).strict();

export const CancelMessageScheduleInputSchema = z
  .object({
    id: UuidSchema,
  })
  .strict();

export interface BotMessageScheduleView {
  readonly id: string;
  readonly message: string;
  readonly hour: number;
  readonly minute: number;
  readonly days: "every" | "weekdays";
  readonly timezone: string;
  readonly clock: string;
  readonly nextRunAt: string | null;
}

export interface BotMessageScheduleStore {
  save(
    botId: string,
    input: { message: string; hour: number; minute: number; days: "every" | "weekdays" },
  ): { schedule: BotMessageScheduleView; created: boolean } | Promise<{
    schedule: BotMessageScheduleView;
    created: boolean;
  }>;
  list(botId: string): readonly BotMessageScheduleView[] | Promise<readonly BotMessageScheduleView[]>;
  cancel(botId: string, id: string): { cancelled: boolean } | Promise<{ cancelled: boolean }>;
}

function requireBot(context: ToolContext): string {
  const botId = context.caller.botId;
  if (typeof botId !== "string" || botId.length === 0) {
    throw new ToolRejectionError("UNAUTHORIZED_PATH", "schedule caller is not bound to a bot");
  }
  return botId;
}

const scheduleMessageShape = {
  name: "schedule_message",
  description:
    "Save a recurring chat message for the calling bot. Use this when the person " +
    "asks this bot to say something on a clock, for example 每天五点给我发个你好. " +
    "Do not tell them to open settings. hour is 0-23 in this computer's local " +
    "timezone: 五点 with no 上午/下午/晚上 is 5, 上午五点 is 5, 下午五点 or 晚上五点 " +
    "is 17, 中午 is 12. minute defaults to 0. days is every (default) or weekdays " +
    "(Monday-Friday). The saved text is posted verbatim in this chat when that " +
    "time arrives and the app is running. A missed time is skipped, not sent late. " +
    "The same text and clock updates the existing schedule instead of adding a " +
    "second one. After this returns, confirm the clock, the days and the timezone " +
    "from the result.",
  inputSchema: ScheduleMessageInputSchema,
} as const;

const listShape = {
  name: "list_message_schedules",
  description:
    "List this bot's active chat schedules: message, clock, timezone and next time. " +
    "Read-only. Use it when the person asks what is scheduled, or before cancelling one.",
  inputSchema: ListMessageSchedulesInputSchema,
} as const;

const cancelShape = {
  name: "cancel_message_schedule",
  description:
    "Stop one of this bot's chat schedules by id from list_message_schedules or " +
    "schedule_message. That text will not be sent again. Another bot's schedule " +
    "cannot be cancelled from here.",
  inputSchema: CancelMessageScheduleInputSchema,
} as const;

export function bindScheduleTools(store: BotMessageScheduleStore): [
  ToolCapability<typeof ScheduleMessageInputSchema>,
  ToolCapability<typeof ListMessageSchedulesInputSchema>,
  ToolCapability<typeof CancelMessageScheduleInputSchema>,
] {
  return [
    {
      ...scheduleMessageShape,
      async handler(params, context) {
        const botId = requireBot(context);
        return store.save(botId, params);
      },
    },
    {
      ...listShape,
      async handler(_params, context) {
        const botId = requireBot(context);
        return { schedules: await store.list(botId) };
      },
    },
    {
      ...cancelShape,
      async handler(params, context) {
        const botId = requireBot(context);
        return store.cancel(botId, params.id);
      },
    },
  ];
}
