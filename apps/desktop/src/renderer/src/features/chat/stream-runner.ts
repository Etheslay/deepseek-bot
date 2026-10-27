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
   * Whether this stream is still the caller's active one. The caller owns that
   * answer (it knows which handle is current); the runner must not infer it from
   * inside a state updater, which is the render phase.
   */
  isCurrent: () => boolean;
}): StreamHandle {
  const { stream, botId, text, forKey, update, onAssistant, isCurrent } = deps;
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
    // `update` is a React state updater: it runs during the render phase and has
    // to stay pure. Committing the assistant message from inside it made React
    // warn — "Cannot update a component (App) while rendering a different
    // component (BotsPlaceholder)" — and drop the update, so a finished reply
    // reached storage and the Host log but never the thread: the bubble stayed
    // on the spinner forever. Decide first, commit outside the updater.
    if (result.cancelled) {
      update((prev) => (prev && prev.forKey === forKey ? { ...applyCancelled(prev), forKey } : prev));
      return;
    }
    if (result.failure) {
      const failure = result.failure;
      update((prev) => (prev && prev.forKey === forKey ? { ...applyFailure(prev, failure), forKey } : prev));
      return;
    }
    // Another chat took the stream over while this turn was in flight: its
    // answer belongs to that conversation, not this one.
    if (!isCurrent()) {
      return;
    }
    onAssistant(acc);
    update((prev) => (prev && prev.forKey === forKey ? null : prev));
  });
  return handle;
}
