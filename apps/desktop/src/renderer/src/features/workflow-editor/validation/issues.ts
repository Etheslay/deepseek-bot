/**
 * Validation assembly for the editor (D07 brief §3.4). Real contract calls:
 * WorkflowDraftSchema parses the draft and validateWorkflowDraft runs the
 * official graph validator, so issues come from contracts — the editor only
 * adds bot-catalog rules the graph validator cannot know (archived/unknown
 * bot ids) and never invents contract fields.
 */
import type { Bot, WorkflowDraft, WorkflowIssue } from "@deepseek-bot/contracts";
import { WorkflowDraftSchema, validateWorkflowDraft } from "@deepseek-bot/contracts";
import { schemaIssuesToWorkflowIssues } from "../workflow-service.js";
import { t } from "../../../i18n.js";

/**
 * Editor-level rules on top of schema + graph validation:
 * - a bot node must reference a live (non-archived) bot from the catalog;
 * - duplicate inputBinding keys would silently shadow each other.
 */
export function editorRuleIssues(draft: WorkflowDraft, bots: readonly Bot[]): WorkflowIssue[] {
  const issues: WorkflowIssue[] = [];
  const byId = new Map(bots.map((bot) => [bot.id, bot]));
  for (const node of draft.nodes) {
    if (node.type === "bot") {
      const bot = node.botId !== undefined ? byId.get(node.botId) : undefined;
      if (node.botId === undefined) {
        issues.push({
          code: "INVALID_INPUT",
          message: t("workflow.nodeWithoutBot", [node.id]),
          nodeId: node.id,
          field: "botId",
        });
      } else if (!bot) {
        issues.push({
          code: "INVALID_INPUT",
          message: t("workflow.unknownBot", [node.id, node.botId]),
          nodeId: node.id,
          field: "botId",
        });
      } else if (bot.archivedAt !== null) {
        issues.push({
          code: "INVALID_INPUT",
          message: t("workflow.botArchived", [bot.name]),
          nodeId: node.id,
          field: "botId",
        });
      }
    }
    const seen = new Set<string>();
    for (const binding of node.inputBindings) {
      if (binding.inputKey.length > 0 && seen.has(binding.inputKey)) {
        issues.push({
          code: "INVALID_INPUT",
          message: t("workflow.duplicateBinding", [node.id, binding.inputKey]),
          nodeId: node.id,
          field: `inputBindings.${binding.inputKey}`,
        });
      }
      seen.add(binding.inputKey);
    }
  }
  return issues;
}

/** Schema + graph (contracts) + editor rules, sorted stably for the panel. */
export function collectIssues(draft: WorkflowDraft, bots: readonly Bot[]): WorkflowIssue[] {
  const parsed = WorkflowDraftSchema.safeParse(draft);
  if (!parsed.success) {
    return [
      ...schemaIssuesToWorkflowIssues(parsed.error.issues, draft),
      ...editorRuleIssues(draft, bots),
    ];
  }
  const issues = [...validateWorkflowDraft(parsed.data), ...editorRuleIssues(draft, bots)];
  issues.sort((a, b) => {
    const nodeA = a.nodeId ?? "";
    const nodeB = b.nodeId ?? "";
    if (nodeA !== nodeB) {
      return nodeA.localeCompare(nodeB);
    }
    return a.message.localeCompare(b.message);
  });
  return issues;
}

export type IssueGroup = {
  /** Node id, or "" for workflow-level issues. */
  nodeId: string;
  issues: WorkflowIssue[];
};

export function groupIssuesByNode(issues: readonly WorkflowIssue[]): IssueGroup[] {
  const groups = new Map<string, WorkflowIssue[]>();
  for (const issue of issues) {
    const key = issue.nodeId ?? "";
    const list = groups.get(key);
    if (list) {
      list.push(issue);
    } else {
      groups.set(key, [issue]);
    }
  }
  return [...groups.entries()]
    .map(([nodeId, list]) => ({ nodeId, issues: list }))
    .sort((a, b) => a.nodeId.localeCompare(b.nodeId));
}

/** Map an issue's field to the inspector element id that edits it. */
export function inspectorFieldId(issue: WorkflowIssue): string | null {
  if (issue.nodeId === undefined) {
    if (issue.field === "name" || issue.field === undefined) {
      return "wf-insp-name";
    }
    return null;
  }
  switch (issue.field) {
    case "botId":
      return "wf-insp-botId";
    case "instructionTemplate":
      return "wf-insp-instructionTemplate";
    case "timeoutSeconds":
      return "wf-insp-timeoutSeconds";
    case "retryPolicy":
    case "retryPolicy.maxRetries":
      return "wf-insp-retry";
    default: {
      const bindingKey = issue.field?.match(/^inputBindings\.(.+)$/)?.[1];
      return bindingKey !== undefined ? `wf-insp-binding-${bindingKey}` : null;
    }
  }
}

/** Node id → issue count, for the canvas error badges. */
export function issueCountByNode(issues: readonly WorkflowIssue[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const issue of issues) {
    if (issue.nodeId !== undefined) {
      counts[issue.nodeId] = (counts[issue.nodeId] ?? 0) + 1;
    }
  }
  return counts;
}
