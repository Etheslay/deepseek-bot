/**
 * T4 workflow tool layer (TASK_MANAGER_ORCHESTRATION.md §3.2, FR-2).
 *
 * `save_workflow` mirrors the contract WorkflowDraftSchema, validates first
 * and only persists a valid draft — one coordinator turn can therefore
 * "build the team's workflow" without leaving the chat. The contract surface
 * keeps owning the business rules; the gateway adds validation + audit.
 *
 * 组队编排不设专门工具：`create_bots_batch` 的描述（write-tools）引导
 * "先建成员、再保存引用其 botId 的工作流"，两个能力合并进同一张审批卡。
 */
import { WorkflowDraftSchema } from "@deepseek-bot/contracts";
import type { ToolCapability } from "./types.js";
import type { ContractCaller } from "./read-tools.js";

const saveWorkflowShape = {
  name: "save_workflow",
  description:
    "Validate and save a workflow document (workflow.validate then " +
    "workflow.save). Nodes reference member bots by botId — create the team " +
    "with create_bots_batch first, then save a workflow that cites those " +
    "ids. The saved workflow appears in the human workflow editor.",
  inputSchema: WorkflowDraftSchema,
} as const;

/** Bind the workflow capability to the contract caller. */
export function bindWorkflowTools(caller: ContractCaller): ToolCapability[] {
  return [
    {
      ...saveWorkflowShape,
      handler: async (params) => {
        const validation = (await caller("workflow.validate", {
          workflow: params,
        })) as { valid: boolean; errors: unknown[] };
        if (!validation.valid) {
          // Invalid drafts never touch storage; the model sees the issues.
          return { saved: false, errors: validation.errors };
        }
        const saved = (await caller("workflow.save", {
          workflow: params,
        })) as Record<string, unknown>;
        return { saved: true, workflow: saved };
      },
    },
  ];
}
