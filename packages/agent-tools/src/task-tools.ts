/**
 * v0.5 manager orchestration tool layer (TASK_MANAGER_ORCHESTRATION.md §3.3).
 *
 * `dispatch_task` hands one instruction to a same-group executor bot; the
 * host's TaskDispatcher owns the queue, the chat turn and the receipts. The
 * gateway-layer role rules (FR-8) live HERE so the model gets an explainable
 * rejection; the `task.dispatch` method handler re-checks them
 * authoritatively (defense in depth, FR-9: 拒绝在网关层，不是 UI 隐藏).
 *
 * The coordinator identity always comes from the trusted `ToolCaller.botId`
 * bound by the Host chat turn — never from model parameters. `list_tasks` is
 * the read-only companion scoped to tasks the caller participates in.
 */
import { TASK_CHAIN_MAX } from "@deepseek-bot/contracts";
import { z } from "zod";
import type { Task } from "@deepseek-bot/contracts";
import { ToolRejectionError, type ToolCapability, type ToolContext } from "./types.js";

/** Minimal bot view the Host resolves from storage for the role rules. */
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
 * Gateway-layer coordinator rules (FR-8): trusted bot caller, coordinator
 * role, same-group live target, never self. Every failure explains itself —
 * the model can correct course instead of retrying blind.
 */
function requireCoordinatorBot(ctx: ToolContext, deps: TaskToolDeps): TaskToolBotView {
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
  if (me.role !== "coordinator") {
    throw new ToolRejectionError(
      "UNAUTHORIZED_PATH",
      "只有协调者（coordinator）角色的 bot 才能派发或查询任务；角色由人类在 bot 编辑器中设置",
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
  // Ungrouped bots share the implicit "未分组" group: null === null dispatches,
  // while any grouped/ungrouped mix or a real group mismatch stays rejected.
  // Mirrored authoritatively in the host's TaskDispatcher.
  if (target.groupId !== me.groupId) {
    throw new ToolRejectionError(
      "UNAUTHORIZED_PATH",
      "只能把任务派发给同一个分组内的 bot；跨组派发 v1 不支持",
    );
  }
}

/** Bind the two task capabilities to host-provided dispatcher access. */
export function bindTaskTools(deps: TaskToolDeps): ToolCapability[] {
  return [
    {
      name: "dispatch_task",
      description:
        "Dispatch one task instruction to another bot in your group (the " +
        "executor runs it as its own chat turn). You must hold the " +
        "coordinator role; cross-group and self targets are rejected. " +
        "Optionally pre-declare a relay chain: each hop {botId, instruction} " +
        "runs after the previous hop succeeds — the whole chain is capped at " +
        "4 hops, must stay inside your group and must not repeat a bot.",
      inputSchema: DispatchTaskInputSchema,
      handler: async (params, ctx) => {
        // The gateway has already validated params against the schema.
        const input = params as DispatchTaskInput;
        const me = requireCoordinatorBot(ctx, deps);
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
        const me = requireCoordinatorBot(ctx, deps);
        return deps.listForBot(me.id, {
          ...(input.status !== undefined ? { status: input.status } : {}),
          ...(input.rootTaskId !== undefined ? { rootTaskId: input.rootTaskId } : {}),
          limit: input.limit,
        });
      },
    },
  ];
}
