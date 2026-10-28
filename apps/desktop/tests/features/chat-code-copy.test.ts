// @vitest-environment jsdom
/**
 * Per-code-block copy buttons in chat (rendered markdown + delegated click).
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatMarkdown } from "../../src/renderer/src/features/chat/chat-markdown.js";
import { renderChatMarkdown } from "../../src/renderer/src/features/chat/markdown.js";
import { setLanguagePreference } from "../../src/renderer/src/i18n.js";

const roots: Root[] = [];

function mount(text: string): HTMLElement {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  act(() => root.render(createElement(ChatMarkdown, { text })));
  return host;
}

beforeEach(() => {
  document.body.textContent = "";
  setLanguagePreference("zh");
});

afterEach(() => {
  for (const root of roots.splice(0)) {
    act(() => root.unmount());
  }
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  delete (navigator as { clipboard?: unknown }).clipboard;
});

describe("code block markup", () => {
  it("wraps a fence in a toolbar carrying the language and a copy button", () => {
    const html = renderChatMarkdown("```ts\nconst a = 1;\n```");
    expect(html).toContain('class="md-code"');
    expect(html).toContain('class="md-code-lang"');
    expect(html).toContain(">ts<");
    expect(html).toContain('class="md-code-copy"');
    expect(html).toContain("复制");
  });

  it("labels an untagged fence with the generic word instead of an empty slot", () => {
    const html = renderChatMarkdown("```\nplain text\n```");
    expect(html).toContain('class="md-code-lang">代码<');
  });

  it("still strips scripts and event handlers after widening the allowlist", () => {
    const html = renderChatMarkdown(
      '<script>alert(1)</script><div onclick="evil()">x</div>[link](javascript:alert(1))\n\n```js\nok();\n```',
    );
    expect(html).not.toContain("<script");
    expect(html).not.toContain("onclick");
    /* no live javascript: link survives (the markdown text form is inert) */
    expect(html).not.toMatch(/href\s*=\s*["']javascript:/i);
    /* the toolbar survives, attacker markup does not */
    expect(html).toContain('class="md-code-copy"');
  });
});

describe("copy interaction", () => {
  it("copies exactly the rendered code text and confirms on the button", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const host = mount("```py\nprint('你好')\n```");
    const button = host.querySelector<HTMLButtonElement>(".md-code-copy");
    expect(button).not.toBeNull();
    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    /* the highlighted markup must collapse to the source text (marked drops the fence's trailing newline) */
    expect(writeText).toHaveBeenCalledWith("print('你好')");
    expect(button?.textContent).toBe("已复制");
    expect(button?.classList.contains("copied")).toBe(true);
  });

  it("falls back to execCommand when the async clipboard is denied", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: async () => { throw new Error("denied"); } },
      configurable: true,
    });
    const exec = vi.fn(() => true);
    document.execCommand = exec as unknown as typeof document.execCommand;
    const host = mount("```\nlegacy copy\n```");
    const button = host.querySelector<HTMLButtonElement>(".md-code-copy");
    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(exec).toHaveBeenCalledWith("copy");
    expect(button?.textContent).toBe("已复制");
  });

  it("reports failure when neither clipboard path works", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: async () => { throw new Error("denied"); } },
      configurable: true,
    });
    document.execCommand = (() => { throw new Error("nope"); }) as unknown as typeof document.execCommand;
    const host = mount("```\nno copy\n```");
    const button = host.querySelector<HTMLButtonElement>(".md-code-copy");
    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(button?.textContent).toBe("复制失败");
    expect(button?.classList.contains("failed")).toBe(true);
  });

  it("keeps the button in one block independent of the next", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const host = mount("```a\nfirst\n```\n\n```b\nsecond\n```");
    const buttons = [...host.querySelectorAll<HTMLButtonElement>(".md-code-copy")];
    expect(buttons).toHaveLength(2);
    await act(async () => {
      buttons[1]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(writeText).toHaveBeenCalledWith("second");
    expect(buttons[0]?.textContent).not.toBe("已复制");
  });

  it("renders the button label in the current language", () => {
    setLanguagePreference("en");
    const host = mount("```ts\nconst a = 1;\n```");
    expect(host.querySelector(".md-code-copy")?.textContent).toBe("Copy");
    expect(host.querySelector(".md-code-copy")?.getAttribute("aria-label")).toBe(
      "Copy this code block",
    );
    setLanguagePreference("zh");
  });
});
