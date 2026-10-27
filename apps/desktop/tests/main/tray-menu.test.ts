import { describe, expect, it } from "vitest";
import {
  botLabel,
  buildTrayMenu,
  trayIconFor,
  trayTooltip,
  type TrayStrings,
} from "../../src/main/tray-menu.js";
import type { TraySyncPayload } from "../../src/shared/system-integration.js";

const strings: TrayStrings = {
  show: "Show window",
  hide: "Hide window",
  settings: "Open settings",
  quit: "Quit DeepSeek Bot",
  noBots: "No bots yet",
  botsHeader: (count) => `${count} bots`,
  status: { idle: "Idle", running: "Answering", "waiting-approval": "Waiting for your approval" },
  unreadMarker: (count) => `${count} unread`,
};

const PNG = "data:image/png;base64,AANA====";

function bot(id: string, name: string, extra: Partial<TraySyncPayload["bots"][number]> = {}) {
  return { id, name, status: "idle" as const, unread: false, icon: PNG, ...extra };
}

describe("tray menu model", () => {
  it("lists every bot with its own icon, then the window commands", () => {
    const state: TraySyncPayload = {
      activeBotId: "b2",
      bots: [bot("b1", "Alpha"), bot("b2", "Beta"), bot("b3", "Gamma", { icon: null })],
    };
    const rows = buildTrayMenu(state, strings);
    const items = rows.filter((row) => row.type === "item");
    const labels = items.map((row) => (row.type === "item" ? row.label : ""));

    expect(rows[0]).toEqual({ type: "header", label: "3 bots", enabled: false });
    expect(labels).toEqual([
      "Beta · Idle",
      "Alpha · Idle",
      "Gamma · Idle",
      "Show window",
      "Hide window",
      "Open settings",
      "Quit DeepSeek Bot",
    ]);
    // A bot without an icon still appears; main then omits the icon attribute.
    const gamma = rows.find((row) => row.type === "item" && row.label.startsWith("Gamma"));
    expect(gamma).toMatchObject({ icon: null, action: { kind: "bot", botId: "b3" } });
  });

  it("orders by attention: active bot first, then approvals, then running, then unread", () => {
    const state: TraySyncPayload = {
      activeBotId: "idle-one",
      bots: [
        bot("idle-one", "Idle one"),
        bot("busy", "Busy", { status: "running" }),
        bot("awaiting", "Awaiting", { status: "waiting-approval" }),
        bot("quiet", "Quiet", { unread: true }),
      ],
    };
    const labels = buildTrayMenu(state, strings)
      .filter((row) => row.type === "item")
      .slice(0, 4)
      .map((row) => (row.type === "item" ? row.label.split(" · ")[0] : ""));
    expect(labels).toEqual(["Idle one", "Awaiting", "Busy", "Quiet"]);
  });

  it("marks the active bot and folds unread into the label and tooltip", () => {
    const state: TraySyncPayload = {
      activeBotId: "b1",
      bots: [bot("b1", "Alpha", { unread: true }), bot("b2", "Beta", { unread: true })],
    };
    expect(botLabel(state.bots[0]!, strings)).toBe("Alpha · Idle 1 unread");
    const rows = buildTrayMenu(state, strings);
    const active = rows.find((row) => row.type === "item" && row.label.startsWith("Alpha"));
    expect(active).toMatchObject({ active: true });
    expect(trayTooltip(state, "DeepSeek Bot", strings)).toBe("DeepSeek Bot — Alpha — Idle — 2 unread");
  });

  it("falls back to the app name when no bot matches the active id", () => {
    const state: TraySyncPayload = { activeBotId: "gone", bots: [bot("b1", "Alpha")] };
    expect(trayTooltip(state, "DeepSeek Bot", strings)).toBe("DeepSeek Bot");
    // The dangling active id is not treated as an icon source.
    expect(trayIconFor(state)).toBe(PNG);
  });

  it("shows a placeholder header instead of an empty menu when there are no bots", () => {
    const rows = buildTrayMenu({ activeBotId: null, bots: [] }, strings);
    expect(rows[0]).toEqual({ type: "header", label: "No bots yet", enabled: false });
    expect(rows.filter((row) => row.type === "item")).toHaveLength(4);
  });

  it("uses the active bot's avatar as the tray image", () => {
    const state: TraySyncPayload = {
      activeBotId: "b2",
      bots: [bot("b1", "Alpha"), bot("b2", "Beta", { icon: "data:image/png;base64,BBBB====" })],
    };
    expect(trayIconFor(state)).toBe("data:image/png;base64,BBBB====");
    expect(trayIconFor({ activeBotId: null, bots: [] })).toBeNull();
  });
});
