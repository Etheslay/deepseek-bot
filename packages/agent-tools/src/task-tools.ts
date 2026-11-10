/**
 * v0.5 manager orchestration tool layer (TASK_MANAGER_ORCHESTRATION.md §3.3),
 * relaxed to interop (TASK_BOT_INTEROP.md).
 *
 * `dispatch_task` hands one instruction to any other live bot — cross-group
 * included; the host's TaskDispatcher owns the queue, the chat turn and the
 * receipts. The gateway-layer identity rules live HERE so the model gets an
 * explainable rejection; the `task.dispatch` method handler re-checks them
 * authoritatively (defense in depth: 拒绝在网关层，不是 UI 隐藏).
 *
 * The sender identity always comes from the trusted `ToolCaller.botId` bound
 * by the Host chat turn — never from model parameters. No role gate: any bot
 * may dispatch. `app.dispatch_task` defaults to allow; a stored ask or deny
 * policy is still the gate.
 * `list_tasks` is the read-only companion scoped to tasks the caller
 * participates in. An optional `idempotencyKey` makes a retried dispatch
 * replay the first task instead of queueing a duplicate.
 */
import { TASK_CHAIN_MAX } from "@deepseek-bot/contracts";
import { z } from "zod";
import type { Task } from "@deepseek-bot/contracts";
import { ToolRejectionError, type ToolCapability, type ToolContext } from "./types.js";

/** Minimal bot view the Host resolves from storage for the identity rules. */
export interface TaskToolBotView {
  readonly id: string;
  readonly name: string;
  readonly role: "standard" | "coordinator";
  readonly groupId: string | null;
  readonly archivedAt: string | null;
}

export interface TaskToolDeps {
  resolveBot(botId: string): TaskToolBotView | undefined;
  dispatch(input: {
    fromBotId: string;
    toBotId: string;
    task: string;
    context?: string;
    chain?: Array<{ botId: string; instruction: string }>;
    /** Idempotency key (interop): a retry with the same key replays the task. */
    idempotencyKey?: string;
    /** Authorization refs from the accepted approval/grant (T7 revalidation). */
    authorization?: { approvalId?: string; grantIds?: readonly string[] };
  }): Promise<Task>;
  /** Participant-scoped query (tasks where the bot is sender or executor). */
  listForBot(
    botId: string,
    filter: { status?: Task["status"]; rootTaskId?: string; limit: number },
  ): Promise<{ tasks: Task[] }>;
}

export const DispatchTaskInputSchema = z
  .object({
    toBotId: z.string().uuid(),
    task: z.string().trim().min(1).max(8_000),
    context: z.string().trim().min(1).max(4_000).optional(),
    chain: z
      .array(
        z
          .object({
            botId: z.string().uuid(),
            instruction: z.string().trim().min(1).max(8_000),
          })
          .strict(),
      )
      .max(TASK_CHAIN_MAX - 1)
      .optional(),
    idempotencyKey: z.string().uuid().optional(),
  })
  .strict();

export type DispatchTaskInput = z.output<typeof DispatchTaskInputSchema>;

export const ListTasksInputSchema = z
  .object({
    status: z
      .enum(["queued", "running", "done", "failed", "cancelled", "skipped", "interrupted"])
      .optional(),
    rootTaskId: z.string().uuid().optional(),
    limit: z.number().int().min(1).max(50).default(20),
  })
  .strict();

export type ListTasksInput = z.output<typeof ListTasksInputSchema>;

/**
 * Gateway-layer sender rules (interop): trusted bot caller, live (not
 * archived). Any bot may dispatch — no role, no group requirement; every
 * failure explains itself so the model can correct course instead of
 * retrying blind.
 */
function requireDispatchingBot(ctx: ToolContext, deps: TaskToolDeps): TaskToolBotView {
  if (ctx.caller.botId === undefined) {
    throw new ToolRejectionError(
      "UNAUTHORIZED_PATH",
      "dispatch_task 需要一个绑定了 bot 的可信调用方（仅聊天回合内可用）",
    );
  }
  const me = deps.resolveBot(ctx.caller.botId);
  if (me === undefined || me.archivedAt !== null) {
    throw new ToolRejectionError(
      "UNAUTHORIZED_PATH",
      "dispatch_task 的调用 bot 不存在或已归档",
    );
  }
  return me;
}

function requireReachableTarget(
  me: TaskToolBotView,
  toBotId: string,
  deps: TaskToolDeps,
): void {
  if (toBotId === me.id) {
    throw new ToolRejectionError("INVALID_INPUT", "不能把任务派发给自己");
  }
  const target = deps.resolveBot(toBotId);
  if (target === undefined || target.archivedAt !== null) {
    throw new ToolRejectionError("INVALID_INPUT", `目标 bot 不存在或已归档：${toBotId}`);
  }
  // Cross-group is allowed (interop); only self and dead targets are
  // rejected. Mirrored authoritatively in the host's TaskDispatcher.
}

/** Bind the two task capabilities to host-provided dispatcher access. */
export function bindTaskTools(deps: TaskToolDeps): ToolCapability[] {
  return [
    {
      name: "dispatch_task",
      description:
        "Dispatch one task instruction to any other live bot — any group (the " +
        "executor runs it as its own chat turn). Call this only when the user " +
        "asked you to hand this work to another bot. A file, slide deck, document, " +
        "or any task they gave to you is your own work: do it yourself, and do not " +
        "ask them for permission to message other bots. `task` is the exact line or " +
        "concrete work they should produce: if the human asked you to send " +
        "「你好」, task is 你好, not a note about how to say it. You cannot dispatch to " +
        "yourself. Bot-to-bot dispatch does not wait for a human permission. " +
        "Optionally pre-declare a relay chain: each hop {botId, " +
        "instruction} runs after the previous hop succeeds — the whole chain " +
        "is capped at 4 hops and must not repeat a bot. Pass a fresh " +
        "idempotencyKey (uuid) when you re-send the same task: the retry " +
        "replays the first task instead of queueing a duplicate.",
      inputSchema: DispatchTaskInputSchema,
      handler: async (params, ctx) => {
        // The gateway has already validated params against the schema.
        const input = params as DispatchTaskInput;
        const me = requireDispatchingBot(ctx, deps);
        requireReachableTarget(me, input.toBotId, deps);
        for (const hop of input.chain ?? []) {
          requireReachableTarget(me, hop.botId, deps);
        }
        return deps.dispatch({
          fromBotId: me.id,
          toBotId: input.toBotId,
          task: input.task,
          ...(input.context !== undefined ? { context: input.context } : {}),
          ...(input.chain !== undefined ? { chain: input.chain } : {}),
          ...(input.idempotencyKey !== undefined
            ? { idempotencyKey: input.idempotencyKey }
            : {}),
          ...(ctx.authorization !== undefined
            ? {
                authorization: {
                  ...(ctx.authorization.approvalId !== undefined
                    ? { approvalId: ctx.authorization.approvalId }
                    : {}),
                  ...(ctx.authorization.grantIds !== undefined
                    ? { grantIds: ctx.authorization.grantIds }
                    : {}),
                },
              }
            : {}),
        });
      },
    },
    {
      name: "list_tasks",
      description:
        "List dispatched tasks where you are the sender or the executor, " +
        "optionally filtered by status or relay root; read-only.",
      inputSchema: ListTasksInputSchema,
      handler: async (params, ctx) => {
        const input = params as ListTasksInput;
        const me = requireDispatchingBot(ctx, deps);
        return deps.listForBot(me.id, {
          ...(input.status !== undefined ? { status: input.status } : {}),
          ...(input.rootTaskId !== undefined ? { rootTaskId: input.rootTaskId } : {}),
          limit: input.limit,
        });
      },
    },
  ];
}
