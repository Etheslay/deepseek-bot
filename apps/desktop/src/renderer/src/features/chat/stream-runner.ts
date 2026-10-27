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
import type { StreamHandle, StreamResult, ToolStatus } from "../../services/desktop-service.js";

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
) => StreamHandle;

export function runChatStream(deps: {
  stream: ChatStreamFn;
  botId: string;
  /** Already composed outgoing text (skill context + user text). */
  text: string;
  forKey: number;
  update: StreamUpdater;
  onAssistant: (text: string) => void;
  /**
   * Optional: reported once per stream with the raw result, after the state has
   * settled. D22's tray status and system notifications need the outcome
   * (success / cancelled / failed) that the reducer folds away.
   */
  onSettled?: (result: StreamResult) => void;
}): StreamHandle {
  const { stream, botId, text, forKey, update, onAssistant, onSettled } = deps;
  let acc = "";
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
  });
  void handle.finish().then((result: StreamResult) => {
    update((prev) => {
      if (!prev || prev.forKey !== forKey) {
        return prev;
      }
      if (result.cancelled) {
        return { ...applyCancelled(prev), forKey };
      }
      if (result.failure) {
        return { ...applyFailure(prev, result.failure), forKey };
      }
      onAssistant(acc);
      return null;
    });
    onSettled?.(result);
  });
  return handle;
}
