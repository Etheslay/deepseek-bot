/**
 * React wrapper for the chat markdown pipeline (D14). Memoized so a
 * re-render of the message list does not re-run marked/katex. Mention
 * chips are linked post-sanitize via the mention table; clicks are
 * delegated here and routed to onMentionClick, and the same delegation
 * serves the per-block copy buttons (the HTML is sanitized innerHTML, so
 * nothing inside it can own a React handler).
 */
import { useMemo, type JSX } from "react";
import { renderChatMarkdown } from "./markdown.js";
import { linkMentions, type MentionTable } from "./mentions.js";
import { copyCodeBlock } from "./code-copy.js";

export function ChatMarkdown(props: {
  text: string;
  mentions?: MentionTable | undefined;
  onMentionClick?: ((botKey: number) => void) | undefined;
}): JSX.Element {
  const html = useMemo(() => {
    const base = renderChatMarkdown(props.text);
    return props.mentions ? linkMentions(base, props.mentions) : base;
  }, [props.text, props.mentions]);

  return (
    <div
      className="chat-md"
      dangerouslySetInnerHTML={{ __html: html }}
      onClick={(event) => {
        const origin = event.target as HTMLElement;
        const copy = origin.closest?.(".md-code-copy");
        if (copy instanceof HTMLElement) {
          void copyCodeBlock(copy);
          return;
        }
        const target = origin.closest?.(".mention-chip");
        if (target instanceof HTMLElement) {
          const key = Number(target.dataset.botKey);
          if (Number.isFinite(key)) {
            props.onMentionClick?.(key);
          }
        }
      }}
    />
  );
}
