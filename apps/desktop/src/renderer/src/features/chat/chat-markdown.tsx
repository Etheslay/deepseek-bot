/**
 * React wrapper for the chat markdown pipeline (D14). Memoized so a
 * re-render of the message list does not re-run marked/katex.
 */
import { useMemo, type JSX } from "react";
import { renderChatMarkdown } from "./markdown.js";

export function ChatMarkdown(props: { text: string }): JSX.Element {
  const html = useMemo(() => renderChatMarkdown(props.text), [props.text]);
  return <div className="chat-md" dangerouslySetInnerHTML={{ __html: html }} />;
}
