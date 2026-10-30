// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * The real mermaid cannot run in jsdom (it measures glyphs), so the module
 * under test is driven through a mocked `mermaid` package: these tests pin
 * the lazy strict-mode initialization, the sanitizer pass and the fail-safe
 * null on render errors. The renderer module memoizes its lazy load, so each
 * test re-imports it after `vi.resetModules()`.
 */
const initialize = vi.fn();
const render = vi.fn();

vi.mock("mermaid", () => ({
  default: {
    initialize,
    render,
  },
}));

async function loadModule(): Promise<
  typeof import("../../src/renderer/src/features/chat/mermaid.js")
> {
  vi.resetModules();
  return import("../../src/renderer/src/features/chat/mermaid.js");
}

beforeEach(() => {
  initialize.mockClear();
  render.mockReset();
});

describe("local mermaid rendering", () => {
  it("initializes lazily in strict mode and returns a sanitized svg", async () => {
    render.mockResolvedValue({
      svg: '<svg><style>.node{fill:#fff}</style><g><script>alert(1)</script><rect onload="alert(2)"></rect></g></svg>',
    });
    const { renderMermaidSvg } = await loadModule();
    const svg = await renderMermaidSvg("flowchart TD\n  A --> B");
    expect(initialize).toHaveBeenCalledWith(
      expect.objectContaining({ startOnLoad: false, securityLevel: "strict" }),
    );
    expect(svg).not.toBeNull();
    expect(svg).toContain("<svg");
    expect(svg).toContain("<style>");
    expect(svg).not.toContain("<script");
    expect(svg).not.toContain("onload");
  });

  it("renders lazily once and serves repeats from the cache", async () => {
    render.mockResolvedValue({ svg: "<svg><g></g></svg>" });
    const { renderMermaidSvg } = await loadModule();
    await renderMermaidSvg("flowchart TD\n  A --> B");
    await renderMermaidSvg("flowchart TD\n  A --> B");
    expect(initialize).toHaveBeenCalledTimes(1);
    expect(render).toHaveBeenCalledTimes(1);
  });

  it("re-renders when the theme changed for the same source", async () => {
    render.mockResolvedValue({ svg: "<svg><g></g></svg>" });
    const { renderMermaidSvg, setMermaidTheme } = await loadModule();
    await renderMermaidSvg("flowchart TD\n  A --> B");
    setMermaidTheme("light");
    await renderMermaidSvg("flowchart TD\n  A --> B");
    expect(render).toHaveBeenCalledTimes(2);
  });

  it("redraws mounted blocks from the theme cache without re-parsing", async () => {
    render.mockResolvedValueOnce({ svg: "<svg>dark-svg</svg>" });
    render.mockResolvedValueOnce({ svg: "<svg>light-svg</svg>" });
    const { renderMermaidSvg, setMermaidTheme } = await loadModule();
    const source = "flowchart TD\n  A --> B";
    const dark = await renderMermaidSvg(source);
    setMermaidTheme("light");
    const light = await renderMermaidSvg(source);
    expect(render).toHaveBeenCalledTimes(2);

    // A mounted block (as chat-markdown mounts it) currently shows the light svg.
    const block = document.createElement("div");
    block.className = "mermaid-block";
    block.dataset.mermaidMounted = "true";
    block.dataset.mermaidSource = source;
    block.attachShadow({ mode: "open" }).innerHTML = light ?? "";
    document.body.appendChild(block);

    setMermaidTheme("dark");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(block.shadowRoot?.innerHTML).toContain("dark-svg");
    // The swap came straight from the cache: mermaid.parse/render never ran again.
    expect(render).toHaveBeenCalledTimes(2);

    // A block whose source was never rendered under the target theme keeps
    // its current svg — no re-parse on a theme flip.
    const cold = document.createElement("div");
    cold.dataset.mermaidMounted = "true";
    cold.dataset.mermaidSource = "flowchart TD\n  X --> Y";
    cold.attachShadow({ mode: "open" }).innerHTML = light ?? "";
    document.body.appendChild(cold);
    setMermaidTheme("light");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(cold.shadowRoot?.innerHTML).toContain("light-svg");
    expect(render).toHaveBeenCalledTimes(2);
    expect(dark).toContain("dark-svg");
  });

  it("returns null when mermaid fails to render", async () => {
    render.mockRejectedValue(new Error("syntax error"));
    const { renderMermaidSvg } = await loadModule();
    expect(await renderMermaidSvg("flowchart TD\n  A -- broken")).toBeNull();
  });

  it("returns null when mermaid produces an empty svg", async () => {
    render.mockResolvedValue({ svg: "" });
    const { renderMermaidSvg } = await loadModule();
    expect(await renderMermaidSvg("flowchart TD\n  A --> B")).toBeNull();
  });

  it("picks the mermaid theme from the app theme at first load", async () => {
    // The module lazy-initializes on first render; this pin asserts the
    // exported theme setter feeds that initialization.
    const { renderMermaidSvg, setMermaidTheme } = await loadModule();
    setMermaidTheme("light");
    render.mockResolvedValue({ svg: "<svg><g></g></svg>" });
    await renderMermaidSvg("flowchart TD\n  A --> B");
    expect(initialize).toHaveBeenCalledWith(
      expect.objectContaining({ theme: "default" }),
    );
  });
});
