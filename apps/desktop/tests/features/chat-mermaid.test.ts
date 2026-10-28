// @vitest-environment jsdom
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatMarkdown } from "../../src/renderer/src/features/chat/chat-markdown.js";
import { renderMermaidSvg } from "../../src/renderer/src/features/chat/mermaid.js";
import { setLanguagePreference } from "../../src/renderer/src/i18n.js";

vi.mock("../../src/renderer/src/features/chat/mermaid.js", () => ({
  renderMermaidSvg: vi.fn(),
  setMermaidTheme: vi.fn(),
}));

const renderMermaidSvgMock = vi.mocked(renderMermaidSvg);

const roots: Root[] = [];

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  setLanguagePreference("zh");
  renderMermaidSvgMock.mockReset();
});

afterEach(() => {
  for (const root of roots.splice(0)) {
    act(() => {
      root.unmount();
    });
  }
  document.body.innerHTML = "";
  setLanguagePreference("zh");
});

async function renderMarkdown(text: string): Promise<HTMLDivElement> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => {
    root.render(createElement(ChatMarkdown, { text }));
  });
  return container;
}

const FENCE = "```mermaid\nflowchart TD\n  A[开始] --> B[结束]\n```";

describe("chat markdown mermaid enhancement", () => {
  it("replaces a mermaid fence with a shadow-root diagram on success", async () => {
    renderMermaidSvgMock.mockResolvedValue("<svg><g>diagram</g></svg>");
    const container = await renderMarkdown(`前置说明\n\n${FENCE}`);
    await vi.waitFor(() => {
      expect(container.querySelector(".mermaid-block")).not.toBeNull();
    });
    const block = container.querySelector(".mermaid-block");
    if (!(block instanceof HTMLElement)) throw new Error("missing mermaid block");
    expect(block.shadowRoot?.innerHTML).toContain("<svg");
    expect(block.shadowRoot?.innerHTML).toContain("diagram");
    // The source code block is gone; the surrounding prose stays.
    expect(container.querySelector("code.language-mermaid")).toBeNull();
    expect(container.textContent).toContain("前置说明");
    expect(renderMermaidSvgMock).toHaveBeenCalledWith("flowchart TD\n  A[开始] --> B[结束]");
  });

  it("keeps the source block with an error note when rendering fails", async () => {
    renderMermaidSvgMock.mockResolvedValue(null);
    const container = await renderMarkdown(FENCE);
    await vi.waitFor(() => {
      expect(container.querySelector(".md-code-mermaid-error")).not.toBeNull();
    });
    expect(container.querySelector(".mermaid-block")).toBeNull();
    const code = container.querySelector("code.language-mermaid");
    expect(code?.textContent).toContain("flowchart TD");
    expect(container.textContent).toContain("流程图渲染失败");
  });

  it("does not touch content without mermaid fences", async () => {
    await renderMarkdown("普通 **加粗** 回复\n\n```ts\nconst a = 1;\n```");
    expect(renderMermaidSvgMock).not.toHaveBeenCalled();
  });

  it("re-enhances after an innerHTML reset and keeps one block", async () => {
    renderMermaidSvgMock.mockResolvedValue("<svg><g>ok</g></svg>");
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => {
      root.render(createElement(ChatMarkdown, { text: FENCE }));
    });
    await vi.waitFor(() => {
      expect(container.querySelector(".mermaid-block")).not.toBeNull();
    });
    await act(async () => {
      root.render(createElement(ChatMarkdown, { text: FENCE }));
    });
    // React may reset the sanitized innerHTML on a commit; the effect
    // re-detects the fresh fence and re-enhances it (the real module caches
    // the render, the mock counts calls).
    expect(renderMermaidSvgMock).toHaveBeenCalledTimes(2);
    expect(container.querySelectorAll(".mermaid-block")).toHaveLength(1);
  });
});
