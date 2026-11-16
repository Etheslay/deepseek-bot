// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { buildTrayPayload, statusToState, syncTrayState, trayIconColors } from "../../src/renderer/src/features/system/tray-sync.js";
import {
  rasterizeTrayIcon,
  trayAvatarSvg,
  TRAY_ICON_PIXELS,
  TRAY_RASTER_TIMEOUT_MS,
} from "../../src/renderer/src/features/system/tray-avatar.js";
import { TRAY_MAX_BOTS, TRAY_NAME_MAX_LENGTH } from "../../src/shared/system-integration.js";
import type { Avatar } from "../../src/renderer/src/features/avatars/avatar-meta.js";

const grok: Avatar = { kind: "grok", shape: "cloud", color: "#f59e0b" };
const mono: Avatar = { kind: "mono" };

describe("tray avatar raster", () => {
  it("builds a self-contained SVG with concrete colors", () => {
    const svg = trayAvatarSvg(grok, trayIconColors("dark"));
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg).toContain('width="32"');
    expect(svg).toContain('fill="#f59e0b"');
    const blue = trayAvatarSvg(
      { kind: "grok", shape: "blob", color: "#2A92FE" },
      trayIconColors("dark"),
    );
    expect(blue).toContain('fill="#4BA8FF"');
    // No CSS variables survive into the tray image.
    expect(svg).not.toContain("var(--");
    expect(svg.match(/<path/g)?.length).toBe(3);
  });

  it("resolves the theme-aware mono avatar to a concrete colour per theme", () => {
    expect(trayAvatarSvg(mono, trayIconColors("dark"))).toContain('fill="#ececf1"');
    expect(trayAvatarSvg(mono, trayIconColors("light"))).toContain('fill="#1a1a1e"');
  });

  it("escapes an injected colour instead of trusting the avatar value", () => {
    const hostile: Avatar = { kind: "grok", shape: "circle", color: '" onload="evil' };
    const svg = trayAvatarSvg(hostile, trayIconColors("dark"));
    expect(svg).not.toContain(' onload="evil');
    expect(svg).toContain("&quot;");
  });

  it("maps tray status onto an avatar expression", () => {
    expect(statusToState("idle")).toBe("idle");
    expect(statusToState("running")).toBe("thinking");
    expect(statusToState("waiting-approval")).toBe("waiting");
  });

  it("rasterize returns null rather than throwing when the canvas is unavailable", async () => {
    // jsdom never fires onload for an SVG data URL: the timeout path must resolve.
    await expect(rasterizeTrayIcon(trayAvatarSvg(grok, trayIconColors("dark")), 25)).resolves.toBeNull();
  });

  it("declares a bounded raster timeout for the real app", () => {
    expect(TRAY_RASTER_TIMEOUT_MS).toBeGreaterThan(0);
    expect(TRAY_RASTER_TIMEOUT_MS).toBeLessThan(5_000);
  });
});

describe("tray payload build", () => {
  const sources = [
    { id: "b1", name: "Alpha", avatar: grok, unread: false, status: "idle" as const },
    { id: "b2", name: "Beta", avatar: mono, unread: true, status: "running" as const },
  ];

  it("pairs rasterised icons with bot entries and keeps the active bot", () => {
    const icons = new Map([
      ["b1", "data:image/png;base64,AAA="],
      ["b2", null],
    ]);
    expect(buildTrayPayload(sources, "b1", icons)).toEqual({
      activeBotId: "b1",
      bots: [
        { id: "b1", name: "Alpha", status: "idle", unread: false, icon: "data:image/png;base64,AAA=" },
        { id: "b2", name: "Beta", status: "running", unread: true, icon: null },
      ],
    });
  });

  it("drops an active id that is no longer in the list", () => {
    const payload = buildTrayPayload(sources, "deleted-bot", new Map());
    expect(payload.activeBotId).toBeNull();
    expect(payload.bots).toHaveLength(2);
  });

  it("caps bots and truncates names to what main will accept", () => {
    const many = Array.from({ length: TRAY_MAX_BOTS + 10 }, (_unused, index) => ({
      id: `b${index}`,
      name: "n".repeat(TRAY_NAME_MAX_LENGTH + 20),
      avatar: grok,
      unread: false,
      status: "idle" as const,
    }));
    const payload = buildTrayPayload(many, null, new Map());
    expect(payload.bots).toHaveLength(TRAY_MAX_BOTS);
    for (const bot of payload.bots) {
      expect(bot.name.length).toBeLessThanOrEqual(TRAY_NAME_MAX_LENGTH);
      expect(() => bot.name).not.toThrow();
    }
  });
});

describe("syncTrayState", () => {
  it("pushes through the bridge and reports the payload it sent", async () => {
    const pushed: unknown[] = [];
    const bridge = {
      system: { tray: { sync: async (payload: unknown): Promise<void> => void pushed.push(payload) } },
    };
    const payload = await syncTrayState(
      [{ id: "b1", name: "Alpha", avatar: grok, unread: false, status: "waiting-approval" }],
      "b1",
      { theme: "dark", rasterize: async () => "data:image/png;base64,QQ==", bridge },
    );
    expect(pushed).toHaveLength(1);
    expect(pushed[0]).toEqual(payload);
    expect(payload?.bots[0]?.icon).toBe("data:image/png;base64,QQ==");
    expect(payload?.bots[0]?.status).toBe("waiting-approval");
  });

  it("survives a bridge that rejects (tray is cosmetic, the UI is not)", async () => {
    const bridge = {
      system: {
        tray: {
          sync: async (): Promise<void> => {
            throw new Error("channel unavailable");
          },
        },
      },
    };
    const payload = await syncTrayState(
      [{ id: "b1", name: "Alpha", avatar: grok, unread: false, status: "idle" }],
      "b1",
      { theme: "light", rasterize: async () => null, bridge },
    );
    expect(payload?.bots[0]?.icon).toBeNull();
  });

  it("returns the payload without a bridge (browser preview)", async () => {
    const payload = await syncTrayState([], null, {
      theme: "dark",
      rasterize: async () => "data:image/png;base64,AA==",
      bridge: null,
    });
    expect(payload).toEqual({ activeBotId: null, bots: [] });
  });

  it("defaults the raster icon size to the tray pixel size", () => {
    expect(TRAY_ICON_PIXELS).toBe(32);
  });
});
