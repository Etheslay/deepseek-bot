import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The notifications module touches the Electron `Notification` API, which cannot
 * load in a Node test process. It is replaced with a recording fake: the point of
 * these tests is the de-duplication and the click routing, not Electron itself.
 */
type FakeNotice = {
  title: string;
  body: string;
  silent: boolean;
  options: Record<string, unknown>;
  shown: boolean;
  listeners: Record<string, Array<() => void>>;
  click: () => void;
};

const shown: FakeNotice[] = [];
let supported = true;

vi.mock("electron", () => {
  class FakeNotification {
    private readonly record: FakeNotice;

    constructor(options: { title: string; body: string; silent?: boolean; icon?: unknown }) {
      this.record = {
        title: options.title,
        body: options.body,
        silent: options.silent ?? false,
        options,
        shown: false,
        listeners: {},
        click: () => {
          for (const listener of this.record.listeners["click"] ?? []) {
            listener();
          }
        },
      };
      shown.push(this.record);
    }

    static isSupported(): boolean {
      return supported;
    }

    on(event: string, listener: () => void): void {
      this.record.listeners[event] = [...(this.record.listeners[event] ?? []), listener];
    }

    show(): void {
      this.record.shown = true;
    }
  }
  return {
    Notification: FakeNotification,
    nativeImage: { createFromDataURL: () => ({ isEmpty: () => true }) },
    __esModule: true,
  };
});

const { createNotificationController } = await import("../../src/main/notifications.js");

const request = (overrides: Record<string, unknown> = {}) => ({
  botId: "bot-1",
  title: "Alpha replied",
  body: "",
  icon: null,
  silent: false,
  ...overrides,
});

function harness(clock = { value: 0 }) {
  const clicks: Array<{ botId: string | null }> = [];
  const controller = createNotificationController({
    getWindow: () => null,
    send: (event) => clicks.push(event),
    now: () => clock.value,
  });
  return { controller, clicks, clock };
}

beforeEach(() => {
  shown.length = 0;
  supported = true;
});

describe("system notifications", () => {
  it("raises a notice and reports success", () => {
    const { controller } = harness();
    expect(controller.show(request())).toEqual({ shown: true, reason: null });
    expect(shown[0]).toMatchObject({ title: "Alpha replied", shown: true });
  });

  it("reports unsupported platforms instead of pretending", () => {
    supported = false;
    const { controller } = harness();
    expect(controller.isSupported()).toBe(false);
    expect(controller.show(request())).toEqual({ shown: false, reason: "unsupported" });
    expect(shown).toHaveLength(0);
  });

  it("collapses an identical burst inside the dedupe window", () => {
    const { controller, clock } = harness();
    expect(controller.show(request()).shown).toBe(true);
    clock.value += 1_000;
    expect(controller.show(request())).toEqual({ shown: false, reason: "duplicate" });
    clock.value += 5_000;
    expect(controller.show(request()).shown).toBe(true);
  });

  it("treats another bot or another title as a different notice", () => {
    const { controller } = harness();
    expect(controller.show(request()).shown).toBe(true);
    expect(controller.show(request({ botId: "bot-2" })).shown).toBe(true);
    expect(controller.show(request({ title: "Beta replied" })).shown).toBe(true);
    expect(shown).toHaveLength(3);
  });

  it("forwards the click to the renderer with the bot id", () => {
    const { controller, clicks } = harness();
    controller.show(request());
    shown[0]?.click();
    expect(clicks).toEqual([{ botId: "bot-1" }]);
  });

  it("drops an icon that cannot be decoded rather than passing an empty image", () => {
    const { controller } = harness();
    controller.show(request({ icon: "data:image/png;base64,AA==" }));
    // The fake nativeImage reports isEmpty() for everything, so no icon is set.
    expect(shown[0]?.options).not.toHaveProperty("icon");
  });
});
