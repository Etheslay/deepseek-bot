/**
 * React wrapper for the chat markdown pipeline (D14). Memoized so a
 * re-render of the message list does not re-run marked/katex. Mention
 * chips are linked post-sanitize via the mention table; clicks are
 * delegated here and routed to onMentionClick, and the same delegation
 * serves the per-block copy buttons (the HTML is sanitized innerHTML, so
 * nothing inside it can own a React handler).
 *
 * D14 follow-up: `mermaid` fences stay plain code blocks through the
 * pipeline and are enhanced after mount — each unprocessed block renders
 * locally into a shadow root (see ./mermaid.ts); on failure the source
 * block stays with an error note.
 */
import { useEffect, useMemo, useRef, type JSX } from "react";
import { parseChatLinkHref, type ChatLinkOpenResult } from "../../../../shared/chat-link.js";
import { renderChatMarkdown } from "./markdown.js";
import { linkMentions, type MentionTable } from "./mentions.js";
import { copyCodeBlock } from "./code-copy.js";
import { renderMermaidSvg } from "./mermaid.js";
import { t } from "../../i18n.js";

const LINK_FAILURE: Record<Exclude<ChatLinkOpenResult, { ok: true }>["reason"], "shell.linkBlocked" | "shell.linkMissing" | "shell.linkOutside"> = {
  blocked: "shell.linkBlocked",
  missing: "shell.linkMissing",
  outside: "shell.linkOutside",
};

async function openChatAnchor(href: string): Promise<ChatLinkOpenResult | null> {
  const bridge = window.deepseekBot;
  if (bridge?.shell === undefined) {
    return null;
  }
  return bridge.shell.openLink(href);
}

export function ChatMarkdown(props: {
  text: string;
  mentions?: MentionTable | undefined;
  onMentionClick?: ((botKey: number) => void) | undefined;
  /** Told when a link cannot be opened. Opening itself happens in the desktop process. */
  onNotify?: ((message: string) => void) | undefined;
}): JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const html = useMemo(() => {
    const base = renderChatMarkdown(props.text);
    return props.mentions ? linkMentions(base, props.mentions) : base;
  }, [props.text, props.mentions]);

  // Runs after every commit: React may reset the sanitized innerHTML on an
  // update even when the html string is unchanged, so freshly written
  // mermaid fences are re-detected here. The dataset flag keeps nodes that
  // survived from being processed twice, and ./mermaid.ts caches renders.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }
    let cancelled = false;
    const blocks = Array.from(
      host.querySelectorAll<HTMLElement>(".md-code code.language-mermaid"),
    ).filter((code) => code.dataset.mermaidState === undefined);
    if (blocks.length === 0) {
      return;
    }
    void (async () => {
      for (const code of blocks) {
        if (cancelled) return;
        code.dataset.mermaidState = "pending";
        const source = code.textContent ?? "";
        const svg = await renderMermaidSvg(source);
        if (cancelled) return;
        const wrapper = code.closest(".md-code");
        if (!wrapper) continue;
        if (svg === null) {
          code.dataset.mermaidState = "failed";
          wrapper.classList.add("md-code-mermaid-failed");
          const note = document.createElement("div");
          note.className = "md-code-mermaid-error";
          note.textContent = t("chat.mermaidRenderFailed");
          wrapper.prepend(note);
          continue;
        }
        code.dataset.mermaidState = "done";
        const block = document.createElement("div");
        block.className = "mermaid-block";
        // The theme redraw (./mermaid.ts) needs the source for the cache key
        // and the mounted marker to find the block again.
        block.dataset.mermaidSource = source;
        block.dataset.mermaidMounted = "true";
        // The shadow root keeps the diagram's inline <style> tree-scoped.
        block.attachShadow({ mode: "open" }).innerHTML = svg;
        wrapper.replaceWith(block);
      }
    })();
    return () => {
      cancelled = true;
    };
  });

  return (
    <div
      ref={hostRef}
      className="chat-md"
      dangerouslySetInnerHTML={{ __html: html }}
      onClick={(event) => {
        const origin = event.target as HTMLElement;
        const copy = origin.closest?.(".md-code-copy");
        if (copy instanceof HTMLElement) {
          void copyCodeBlock(copy);
          return;
        }
        const anchor = origin.closest?.("a");
        if (anchor instanceof HTMLAnchorElement) {
          const href = anchor.getAttribute("href");
          if (href !== null && parseChatLinkHref(href) !== null) {
            event.preventDefault();
            event.stopPropagation();
            void openChatAnchor(href).then((result) => {
              if (result !== null && !result.ok) {
                props.onNotify?.(t(LINK_FAILURE[result.reason]));
              }
            });
            return;
          }
        }
        const target = origin.closest?.(".mention-chip");
        if (target instanceof HTMLElement) {
          const key = Number(target.dataset.botKey);
          if (Number.isFinite(key)) {
            event.stopPropagation();
            props.onMentionClick?.(key);
          }
        }
      }}
    />
  );
}
