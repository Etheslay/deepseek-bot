/**
 * Chat streaming reducer (D05 brief §2.1 聊天界面).
 *
 * Pure functions: increment deltas, tool status cards, cancel, failure and
 * history replay are all modeled here so the UI stays thin and the states
 * are unit-testable (D5-6/D5-7).
 */
import type { ErrorCode, EventEnvelope } from "@deepseek-bot/contracts";
import type { ChatFailure, ToolStatus } from "../../services/desktop-service.js";

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
      return "任务已创建";
    case "run.statusChanged": {
      const p = event.payload as { from?: string; to?: string; reason?: string };
      return `任务状态：${p.from ?? "?"} → ${p.to ?? "?"}${p.reason ? `（${p.reason}）` : ""}`;
    }
    case "node.statusChanged": {
      const p = event.payload as { nodeId?: string; from?: string; to?: string; reason?: string };
      return `节点 ${p.nodeId ?? "?"}：${p.from ?? "?"} → ${p.to ?? "?"}${p.reason ? `（${p.reason}）` : ""}`;
    }
    case "run.completed":
      return "任务已完成";
    case "run.failed":
      return "任务失败";
    case "tool.requested":
      return "工具请求";
    case "approval.requested":
      return "等待审批";
    case "approval.resolved":
      return "审批已处理";
    default:
      return event.type;
  }
}

export function replayTimeline(events: EventEnvelope[]): ReplayItem[] {
  const items: ReplayItem[] = [];
  let lastStamp = "";
  for (const event of events) {
    const stamp = new Date(event.timestamp).toLocaleString();
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
      return "请求过于频繁，请稍后重试。";
    case "AUTH_FAILED":
      return "认证失败，请检查 API 配置。";
    case "MODEL_UNAVAILABLE":
      return "模型暂不可用，请稍后重试。";
    case "CANCELLED":
      return "已取消。";
    default:
      return "请求失败，请检查模型配置。";
  }
}
