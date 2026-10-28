/**
 * Chat streaming reducer (D05 brief §2.1 聊天界面).
 *
 * Pure functions: increment deltas, tool status cards, cancel, failure and
 * history replay are all modeled here so the UI stays thin and the states
 * are unit-testable (D5-6/D5-7).
 */
import type { ErrorCode, EventEnvelope } from "@deepseek-bot/contracts";
import type { ChatFailure, ToolStatus } from "../../services/desktop-service.js";
import { formatFullDateTime, t } from "../../i18n.js";

export type ToolCard = {
  toolName: string;
  state: ToolStatus["state"];
  summary?: string;
};

export type StreamState = {
  text: string;
  tools: ToolCard[];
  failure: ChatFailure;
  cancelled: boolean;
};

export const emptyStream = (): StreamState => ({
  text: "",
  tools: [],
  failure: null,
  cancelled: false,
});

export function applyDelta(state: StreamState, chunk: string): StreamState {
  if (state.failure || state.cancelled) {
    return state;
  }
  return { ...state, text: state.text + chunk };
}

export function applyTool(state: StreamState, tool: ToolCard): StreamState {
  if (state.failure || state.cancelled) {
    return state;
  }
  const existing = state.tools.find((t) => t.toolName === tool.toolName);
  if (!existing) {
    return { ...state, tools: [...state.tools, tool] };
  }
  return {
    ...state,
    tools: state.tools.map((t) => (t.toolName === tool.toolName ? tool : t)),
  };
}

export function applyFailure(
  state: StreamState,
  failure: NonNullable<ChatFailure>,
): StreamState {
  if (state.failure || state.cancelled) {
    return state;
  }
  return { ...state, failure };
}

export function applyCancelled(state: StreamState): StreamState {
  if (state.failure) {
    return state;
  }
  return { ...state, cancelled: true };
}

/** UI-only replay timeline items derived from persisted EventEnvelopes. */
export type ReplayItem =
  | { kind: "time"; text: string }
  | { kind: "event"; label: string; detail: string };

export function eventLabel(event: EventEnvelope): string {
  switch (event.type) {
    case "run.created":
      return t("chat.runCreated");
    case "run.statusChanged": {
      const p = event.payload as { from?: string; to?: string; reason?: string };
      return t("chat.runStatusChanged", [p.from ?? "?", p.to ?? "?", p.reason ? `（${p.reason}）` : ""]);
    }
    case "node.statusChanged": {
      const p = event.payload as { nodeId?: string; from?: string; to?: string; reason?: string };
      return t("chat.nodeStatusChanged", [p.nodeId ?? "?", p.from ?? "?", p.to ?? "?", p.reason ? `（${p.reason}）` : ""]);
    }
    case "run.completed":
      return t("chat.runCompleted");
    case "run.failed":
      return t("chat.runFailed");
    case "tool.requested":
      return t("chat.toolRequest");
    case "approval.requested":
      return t("chat.awaitingApproval");
    case "approval.resolved":
      return t("chat.approvalResolved");
    default:
      return event.type;
  }
}

export function replayTimeline(events: EventEnvelope[]): ReplayItem[] {
  const items: ReplayItem[] = [];
  let lastStamp = "";
  for (const event of events) {
    const stamp = formatFullDateTime(event.timestamp);
    if (stamp !== lastStamp) {
      items.push({ kind: "time", text: stamp });
      lastStamp = stamp;
    }
    items.push({ kind: "event", label: eventLabel(event), detail: `#${event.sequence}` });
  }
  return items;
}

/** Stable user-facing message for a chat failure code. */
export function failureMessage(code: ErrorCode): string {
  switch (code) {
    case "RATE_LIMITED":
      return t("chat.rateLimited");
    case "AUTH_FAILED":
      return t("chat.authFailed");
    case "MODEL_UNAVAILABLE":
      return t("chat.modelUnavailable");
    case "BUDGET_EXCEEDED":
      /* out of credit reads differently from "the model is down"; retrying is pointless */
      return t("chat.budgetExhausted");
    case "CANCELLED":
      return t("chat.cancelled");
    default:
      return t("chat.requestFailed");
  }
}
