/**
 * Automation visibility tool (D20 slice two). Read-only: the model can
 * report which trigger rules exist, whether they are enabled and what waits
 * in the review queue — 启停状态在聊天内可见 from the platform side. It can
 * neither create, enable nor decide anything.
 */
import { z } from "zod";
import type { ToolCapability } from "./types.js";

export const AutomationListInputSchema = z.object({}).strict();

export interface AutomationRuleView {
  readonly id: string;
  readonly name: string;
  readonly eventType: string;
  readonly enabled: boolean;
}

export interface AutomationFiringView {
  readonly id: string;
  readonly ruleName: string;
  readonly reason: string;
  readonly at: string;
}

export interface AutomationStore {
  overview(): {
    rules: readonly AutomationRuleView[];
    pendingFirings: readonly AutomationFiringView[];
  } | Promise<{
    rules: readonly AutomationRuleView[];
    pendingFirings: readonly AutomationFiringView[];
  }>;
}

export function bindAutomationTools(
  store: AutomationStore,
): [ToolCapability<typeof AutomationListInputSchema>] {
  return [
    {
      name: "list_automations",
      description:
        "List this machine's event-automation rules (name, watched event, enabled state) " +
        "and the firings waiting in the review queue. Read-only: enabling rules and " +
        "approving firings are human actions in settings.",
      inputSchema: AutomationListInputSchema,
      async handler() {
        return store.overview();
      },
    },
  ];
}
