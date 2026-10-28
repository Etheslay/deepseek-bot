// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderChatMarkdown } from "../../src/renderer/src/features/chat/markdown.js";

describe("chat markdown pipeline", () => {
  it("renders GFM headings, lists, tables and links", () => {
    const html = renderChatMarkdown(
      "## 标题\n\n- 甲\n- 乙\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n[DeepSeek](https://api.deepseek.com)",
    );
    expect(html).toContain("<h2>标题</h2>");
    expect(html).toContain("<li>甲</li>");
    expect(html).toContain("<td>1</td>");
    expect(html).toContain('href="https://api.deepseek.com"');
  });

  it("highlights fenced code with hljs classes", () => {
    const html = renderChatMarkdown(
      "```typescript\nconst answer: number = 42;\n```",
    );
    expect(html).toContain("language-typescript");
    expect(html).toContain("hljs-keyword");
    expect(html).toContain("hljs-number");
  });

  it("renders display and inline math via KaTeX", () => {
    const html = renderChatMarkdown(
      "$$E = mc^2$$ 以及 $\\sum_{i=1}^{n} i$",
    );
    expect(html).toContain('class="katex-display"');
    expect((html.match(/class="katex"/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it("protects math syntax from the GFM pass", () => {
    // subscripts/asterisks inside math must not become em/strong
    const html = renderChatMarkdown("$a_1 * b_2 = c^2$");
    expect(html).not.toContain("<em>");
    expect(html).toContain("katex");
  });

  it("leaves shell-style dollar signs untouched (no false math)", () => {
    const html = renderChatMarkdown("复制文件：cp $HOME $BACKUP 目录");
    expect(html).not.toContain("katex");
    expect(html).toContain("$HOME");
  });

  it("sanitizes hostile html from model output", () => {
    const html = renderChatMarkdown(
      '<script>alert(1)</script>\n\n<img src=x onerror="alert(2)">\n\n[点击](javascript:alert(3))',
    );
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("onerror");
    expect(html).not.toContain("javascript:");
  });

  it("keeps plain text visually unchanged (no wrapper noise)", () => {
    const html = renderChatMarkdown("你好，我是普通回复。");
    expect(html).toContain("你好，我是普通回复。");
  });

  it("leaves mermaid fences as escape-text code blocks for post-mount enhancement", () => {
    // D14 follow-up: the pipeline does not render mermaid itself — the
    // component enhances `language-mermaid` blocks after mount, so the
    // sanitized HTML must carry the source as plain escaped text.
    const html = renderChatMarkdown(
      "```mermaid\nflowchart TD\n  A[开始] --> B{判断}\n  B -->|是| C[结束]\n```",
    );
    expect(html).toContain("language-mermaid");
    expect(html).toContain("flowchart TD");
    expect(html).toContain("A[开始]");
    expect(html).not.toContain("<svg");
  });
});
