// @vitest-environment jsdom
import { createElement, type ReactElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { GrokBall } from "../../src/renderer/src/features/avatars/grok-ball.js";

describe("GrokBall solid renderer", () => {
  let host: HTMLDivElement | null = null;
  let root: Root | null = null;

  function mount(el: ReactElement): void {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    act(() => {
      root?.render(el);
    });
  }

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    host?.remove();
    root = null;
    host = null;
  });

  it("paints mesh faces on animated frames and keeps eyes attached", async () => {
    mount(createElement(GrokBall, { variant: "preview", shape: "circle", color: "#3b93f0" }));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 120));
    });
    const svg = host!.querySelector(".grok-ball");
    expect(svg).not.toBeNull();
    const meshGroup = svg!.querySelectorAll(":scope > g")[0]!;
    expect(meshGroup.children.length, "mesh faces").toBeGreaterThan(10);
    const eye = svg!.querySelector(".gb-eye")!.parentElement!.getAttribute("transform") ?? "";
    expect(eye).toContain("scale");
  });

  it("renders a static three-quarter solid for inline variants", () => {
    mount(createElement(GrokBall, { variant: "inline", shape: "triangle", color: "#f0b429" }));
    const svg = host!.querySelector(".grok-ball");
    const meshGroup = svg!.querySelectorAll(":scope > g")[0]!;
    expect(meshGroup.children.length, "tetra faces").toBeGreaterThanOrEqual(3);
  });
});
