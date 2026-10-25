/**
 * Chat markdown rendering (D14). Pipeline:
 *
 * 1. lift $$display$$ / $inline$ math out into placeholders so marked's
 *    GFM pass cannot chew on math syntax (subscripts, asterisks);
 * 2. marked -> HTML (code fences highlighted by highlight.js);
 * 3. DOMPurify sanitize with a strict allowlist (no style attr needed);
 * 4. substitute placeholders back with KaTeX output, which is generated
 *    from the raw math source by katex itself (trust off, errors rendered
 *    as text) and therefore safe to inject post-sanitize.
 *
 * All assets ship in the bundle — no CDN requests at render time.
 */
import DOMPurify from "dompurify";
import hljs from "highlight.js/lib/common";
import katex from "katex";
import { Marked } from "marked";
// KaTeX layout + fonts ship from the npm package (bundled locally).
import "katex/dist/katex.min.css";

/** Inline math must look like math before we touch it: bare `$1 $2` shell
 * variables stay untouched. */
const INLINE_MATH_HINT = /[\\^_{}=]|[0-9]\s*[+\-*/]\s*[0-9]/;

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderKatex(body: string, displayMode: boolean): string {
  try {
    return katex.renderToString(body.trim(), { displayMode, throwOnError: false });
  } catch {
    return escapeHtml(displayMode ? `$$${body}$$` : `$${body}$`);
  }
}

function liftMath(source: string): { text: string; math: string[] } {
  const math: string[] = [];
  let text = source.replace(/\$\$([^$]+)\$\$/g, (_m, body: string) => {
    math.push(renderKatex(body, true));
    return `zzmathph${math.length - 1}zz`;
  });
  text = text.replace(/\$([^$\n]+)\$/g, (m, body: string) => {
    if (!INLINE_MATH_HINT.test(body)) {
      return m;
    }
    math.push(renderKatex(body, false));
    return `zzmathph${math.length - 1}zz`;
  });
  return { text, math };
}

function highlightCode(code: string, lang: string): string {
  const language = lang.toLowerCase();
  if (language && hljs.getLanguage(language)) {
    return hljs.highlight(code, { language, ignoreIllegals: true }).value;
  }
  return escapeHtml(code);
}

const parser = new Marked({
  gfm: true,
  breaks: true,
  renderer: {
    code({ text, lang }: { text: string; lang?: string }) {
      const language = (lang ?? "").split(/\s+/)[0] ?? "";
      return `<pre><code class="hljs language-${escapeHtml(language)}">${highlightCode(text, language)}</code></pre>\n`;
    },
  },
});

/** Render untrusted chat text to sanitized HTML. */
export function renderChatMarkdown(source: string): string {
  const { text, math } = liftMath(source);
  const markedHtml = parser.parse(text) as string;

  const clean = DOMPurify.sanitize(markedHtml, {
    ALLOWED_TAGS: [
      "p", "br", "strong", "em", "del", "s", "code", "pre", "span",
      "ul", "ol", "li", "blockquote", "h1", "h2", "h3", "h4", "h5", "h6",
      "table", "thead", "tbody", "tr", "th", "td", "a",
    ],
    ALLOWED_ATTR: ["class", "href", "title"],
    ALLOW_DATA_ATTR: false,
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:)/i,
  });

  return clean.replace(/zzmathph(\d+)zz/g, (_m, index: string) => {
    const rendered = math[Number(index)];
    return rendered ?? "";
  });
}
