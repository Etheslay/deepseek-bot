/**
 * Shared chat-stream runner (choice card wiring task).
 *
 * The composer send, the failure retry and the choice-card sends all go
 * through this one function so the three paths behave identically: same
 * delta/tool handling, same cancel/failure transitions and the same
 * "assistant bubble on success" side effect. The caller owns the fresh-state
 * reset and cancelling a previous stream. Pure dependency injection keeps it
 * unit-testable without React.
 */
import {
  applyCancelled,
  applyDelta,
  applyFailure,
  applyTool,
  type StreamState,
} from "./chat-reducer.js";
import type {
  StreamHandle,
  StreamOptions,
  StreamResult,
  ToolStatus,
} from "../../services/desktop-service.js";

export type StreamStateForBot = StreamState & { forKey: number };

export type StreamUpdater = (
  update: (prev: StreamStateForBot | null) => StreamStateForBot | null,
) => void;

export type ChatStreamFn = (
  botId: string,
  text: string,
  handlers: {
    onDelta: (chunk: string) => void;
    onTool: (tool: ToolStatus) => void;
  },
  options?: StreamOptions,
) => StreamHandle;

export function runChatStream(deps: {
  stream: ChatStreamFn;
  botId: string;
  /** User text only. Bound skills travel in `skills`, not inside this string. */
  text: string;
  skills?: StreamOptions["skills"];
  /** 原始人模式: terse one-step prompt on the Host. Independent of skills. */
  primitive?: boolean;
  forKey: number;
  update: StreamUpdater;
  onAssistant: (text: string) => void;
  /**
   * Whether this stream is still the caller's active one. The caller owns that
   * answer (it knows which handle is current); the runner must not infer it from
   * inside a state updater, which is the render phase.
   */
  isCurrent: () => boolean;
  /**
   * Optional: reported once per stream with the raw result, after the state has
   * settled. D22's tray status and system notifications need the outcome
   * (success / cancelled / failed) that the reducer folds away.
   */
  onSettled?: (result: StreamResult) => void;
}): StreamHandle {
  const { stream, botId, text, skills, primitive, forKey, update, onAssistant, isCurrent, onSettled } = deps;
  let acc = "";
  const options: StreamOptions | undefined =
    (skills !== undefined && skills.length > 0) || primitive === true
      ? {
          ...(skills !== undefined && skills.length > 0 ? { skills } : {}),
          ...(primitive === true ? { primitive: true } : {}),
        }
      : undefined;
  const handle = stream(botId, text, {
    onDelta: (chunk) => {
      acc += chunk;
      update((prev) =>
        prev && prev.forKey === forKey ? { ...applyDelta(prev, chunk), forKey } : prev,
      );
    },
    onTool: (tool) => {
      update((prev) =>
        prev && prev.forKey === forKey ? { ...applyTool(prev, tool), forKey } : prev,
      );
    },
  }, options);
  void handle.finish().then((result: StreamResult) => {
    // `update` is a React state updater: it runs during the render phase and has
    // to stay pure. Committing the assistant message from inside it made React
    // warn — "Cannot update a component (App) while rendering a different
    // component (BotsPlaceholder)" — and drop the update, so a finished reply
    // reached storage and the Host log but never the thread: the bubble stayed
    // on the spinner forever. Decide first, commit outside the updater.
    // A superseded turn (the same bot started a newer one that took the handle
    // over) must not fold its cancelled/failure state into the newer turn's
    // pending bubble, so those branches check isCurrent as well.
    if (result.cancelled) {
      if (!isCurrent()) {
        onSettled?.(result);
        return;
      }
      update((prev) => (prev && prev.forKey === forKey ? { ...applyCancelled(prev), forKey } : prev));
      onSettled?.(result);
      return;
    }
    if (result.failure) {
      if (!isCurrent()) {
        onSettled?.(result);
        return;
      }
      const failure = result.failure;
      update((prev) =>
        prev && prev.forKey === forKey ? { ...applyFailure(prev, failure), forKey } : prev,
      );
      onSettled?.(result);
      return;
    }
    // Another chat took the stream over while this turn was in flight: its
    // answer belongs to that conversation, not this one, and that turn reports
    // its own settlement.
    if (!isCurrent()) {
      return;
    }
    // B6: the host path carries the authoritative reply in `result.text` —
    // live segments of a tool turn can include narration the reply does not
    // carry, so the accumulated deltas are not always the message. Paths
    // without `text` (fixture, degraded bridge) keep the accumulation.
    onAssistant(result.text ?? acc);
    update((prev) => (prev && prev.forKey === forKey ? null : prev));
    onSettled?.(result);
  });
  return handle;
}
