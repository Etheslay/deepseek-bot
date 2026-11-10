/**
 * Renders the pending "thinking" indicator: the bot's ball in the state the
 * real turn progress implies, plus the stage copy.
 *
 * Polls `chat.status` once a second (the house pattern — question cards poll
 * the same way) so the stage copy only ever repeats what the harness actually
 * reported: preparing → thinking → tool calls by name. The ticker doubles as
 * the elapsed-hint clock, so no extra timers are needed. The component
 * unmounts as soon as the first reply chunk arrives.
 *
 * The visible copy changes with the turn, so it stays aria-hidden; the
 * `aria-live` region carries one stable truthful sentence ("正在处理…").
 */
import { useEffect, useRef, useState, type JSX } from "react";
import { METHOD_CONTRACTS } from "@deepseek-bot/contracts";
import { Avatar } from "../avatars/avatar.js";
import type { Avatar as AvatarConfig } from "../avatars/avatar-meta.js";
import { thinkingStatus, type ChatTurnStage } from "./thinking-status.js";
import { t, useLanguage } from "../../i18n.js";

type TurnProgress = { stage: ChatTurnStage; toolName?: string };

export function ThinkingLine(props: {
  botId: string;
  avatar: AvatarConfig;
  /** Word or PDF is on this turn, so the wait is the file being read. */
  readingFile?: boolean;
}): JSX.Element {
  useLanguage();
  const startedAt = useRef<number>(Date.now());
  const [elapsedMs, setElapsedMs] = useState<number>(0);
  // The turn has just been sent, so "preparing" is the honest default until
  // the first poll reports what the host actually sees.
  const [progress, setProgress] = useState<TurnProgress>({ stage: "preparing" });

  useEffect(() => {
    let active = true;
    const poll = async (): Promise<void> => {
      try {
        const response = await window.deepseekBot.host.call("chat.status", {
          botId: props.botId,
        });
        if (!active) return;
        const parsed = METHOD_CONTRACTS["chat.status"].response.parse(response);
        if (parsed.active) {
          setProgress({
            stage: parsed.stage === "idle" ? "thinking" : parsed.stage,
            ...(parsed.toolName !== undefined ? { toolName: parsed.toolName } : {}),
          });
        }
      } catch {
        // Host hiccup: keep the last known stage rather than inventing one.
      }
    };
    void poll();
    const timer = setInterval(() => {
      setElapsedMs(Date.now() - startedAt.current);
      void poll();
    }, 1000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [props.botId]);

  const status = thinkingStatus({
    ...progress,
    elapsedMs,
    hasText: false,
    ...(props.readingFile ? { readingFile: true } : {}),
  });

  return (
    <span className="thinking-line">
      <span className="thinking-announce" role="status" aria-live="polite">
        {t("chat.thinkingBusy")}
      </span>
      <Avatar
        avatar={props.avatar}
        state={progress.stage === "tool" ? "working" : "thinking"}
        size={28}
      />
      <span className="thinking-text" aria-hidden="true">
        {status?.text ?? t("chat.thinkingBusy")}
      </span>
      {status?.hint ? (
        <span className="thinking-hint" aria-hidden="true">
          {status.hint}
        </span>
      ) : null}
    </span>
  );
}
