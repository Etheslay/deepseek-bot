/**
 * Renders the task-aware "thinking" line while a reply is pending.
 *
 * Owns its own one-second ticker so the elapsed hint and the phase copy advance
 * without stream events; it takes over the mount time rather than extending
 * `StreamState`, which keeps the chat reducer's model untouched. The component
 * unmounts as soon as the first reply chunk arrives (the caller renders the
 * text instead).
 *
 * The visible copy advances through the wait phases every second or so, so it
 * stays aria-hidden; the stable task-aware sentence is what the `aria-live`
 * region announces, once.
 */
import { useEffect, useRef, useState, type JSX } from "react";
import { thinkingStatus } from "./thinking-status.js";
import { t, useLanguage } from "../../i18n.js";

export function ThinkingLine(props: { request: string }): JSX.Element {
  useLanguage();
  const startedAt = useRef<number>(Date.now());
  const [elapsedMs, setElapsedMs] = useState<number>(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setElapsedMs(Date.now() - startedAt.current);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const status = thinkingStatus({
    request: props.request,
    elapsedMs,
    hasText: false,
  });

  return (
    <span className="thinking-line">
      <span className="thinking-announce" role="status" aria-live="polite">
        {status?.announce ?? t("chat.thinkingBusy")}
      </span>
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
