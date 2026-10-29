// @vitest-environment jsdom
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ContextRing } from "../../src/renderer/src/features/chat/context-ring.js";
import type { ContextUsageView } from "../../src/renderer/src/services/desktop-service.js";

const roots: Root[] = [];

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  for (const root of roots.splice(0)) {
    act(() => {
      root.unmount();
    });
  }
  document.body.innerHTML = "";
});

function renderRing(usage: ContextUsageView | null): HTMLElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => {
    root.render(createElement(ContextRing, { usage }));
  });
  return container;
}

function gauge(percent: number): ContextUsageView {
  return {
    percent,
    usedTokens: percent * 64,
    windowTokens: 6_400,
    estimated: false,
    compressedAt: null,
    compressing: false,
  };
}

describe("context ring (TASK_CONTEXT_METER.md)", () => {
  it("speaks the percentage on hover and draws the arc for it", () => {
    const container = renderRing(gauge(76));
    const ring = container.querySelector("[data-testid='context-ring']");
    if (ring === null) throw new Error("missing context ring");
    expect(ring.getAttribute("title")).toBe("上下文已用 76%");
    expect(ring.getAttribute("aria-label")).toBe("上下文已用 76%");
    expect(ring.classList.contains("warn")).toBe(false);
    const fill = ring.querySelector(".context-ring-fill");
    if (fill === null) throw new Error("missing ring fill");
    const [dash] = (fill.getAttribute("stroke-dasharray") ?? "0 0").split(" ");
    // 76% of the 2π·8 circumference ≈ 38.2
    expect(Number(dash)).toBeCloseTo(2 * Math.PI * 8 * 0.76, 1);
  });

  it("marks the warning tone at the 80% fold threshold", () => {
    const container = renderRing(gauge(80));
    const ring = container.querySelector("[data-testid='context-ring']");
    expect(ring?.classList.contains("warn")).toBe(true);
  });

  it("shows an empty quiet ring when no gauge is known yet", () => {
    const container = renderRing(null);
    const ring = container.querySelector("[data-testid='context-ring']");
    expect(ring?.getAttribute("title")).toBe("上下文已用 0%");
    expect(ring?.querySelector(".context-ring-value")).toBeNull();
  });
});
