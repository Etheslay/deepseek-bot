/**
 * useBots returns a filtered copy of its state (`bots.filter(...)`). Effects
 * key on the `bots` reference — the G12 session loader resets historySessions
 * on every run — so a fresh array per render looped those effects forever and
 * made the sidebar session sublist flash (first seen on a real machine
 * 2026-11-01). The filter is memoized now; these tests pin the identity.
 */
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Bot } from "@deepseek-bot/contracts";
import { ServiceProvider } from "../../src/renderer/src/services/service-context.jsx";
import { useBots } from "../../src/renderer/src/features/bots/use-bots.js";
import type { DesktopService } from "../../src/renderer/src/services/desktop-service.js";

const roots: Root[] = [];
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  document.body.textContent = "";
});
afterEach(() => {
  for (const root of roots.splice(0)) {
    act(() => root.unmount());
  }
  document.body.innerHTML = "";
  delete (window as { deepseekBot?: unknown }).deepseekBot;
});

function bot(id: string): Bot {
  return { id, name: `bot-${id}` } as unknown as Bot;
}

function stubService(list: Bot[]): DesktopService {
  return {
    bots: { list: async () => list },
  } as unknown as DesktopService;
}

function probeRoot(box: { current: ReturnType<typeof useBots> | null }, service: DesktopService): {
  render: () => Promise<void>;
} {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  const element = createElement(ServiceProvider, { service } as never, createElement(function Probe() {
    box.current = useBots(0);
    return null;
  }));
  return {
    render: async () => {
      await act(async () => {
        root.render(element);
      });
    },
  };
}

describe("useBots identity stability", () => {
  it("returns the same bots array across re-renders with no state change", async () => {
    const box: { current: ReturnType<typeof useBots> | null } = { current: null };
    const probe = probeRoot(box, stubService([bot("11111111-1111-4111-8111-111111111111")]));
    await probe.render();
    expect(box.current?.bots).toHaveLength(1);
    const first = box.current?.bots;
    await probe.render();
    expect(box.current?.bots).toBe(first);
  });

  it("still recomputes the filtered list when a bot is hidden", async () => {
    const box: { current: ReturnType<typeof useBots> | null } = { current: null };
    const probe = probeRoot(box, stubService([
      bot("22222222-2222-4222-8222-222222222222"),
      bot("33333333-3333-4333-8333-333333333333"),
    ]));
    await probe.render();
    expect(box.current?.bots).toHaveLength(2);
    const before = box.current?.bots;
    act(() => {
      box.current?.hide(1);
    });
    expect(box.current?.bots).toHaveLength(1);
    expect(box.current?.bots).not.toBe(before);
  });
});
