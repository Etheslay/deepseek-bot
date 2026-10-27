import { describe, expect, it, vi } from "vitest";
import {
  ALLOWED_CHANNELS,
  HOST_EVENT_MISSED,
  IPC_CHANNELS,
  IpcDeniedError,
  SYSTEM_EVENT_NOTIFICATION_CLICK,
  SYSTEM_EVENT_TRAY_ACTION,
  SYSTEM_EVENT_WINDOW_FOCUS,
  assertAllowedChannel,
  assertValidLanguagePreference,
  assertValidTitleBarOverlayColors,
} from "../src/shared/ipc-channels.js";
import { assertAuthorizedSender } from "../src/main/ipc/guards.js";
import type { IpcMainInvokeEvent } from "electron";

describe("IPC allowlist", () => {
  it("accepts only registered channels", () => {
    expect(ALLOWED_CHANNELS.has(IPC_CHANNELS.APP_GET_INFO)).toBe(true);
    expect(ALLOWED_CHANNELS.has(IPC_CHANNELS.WINDOW_SET_TITLEBAR_OVERLAY)).toBe(true);
    expect(() => assertAllowedChannel(IPC_CHANNELS.APP_GET_INFO)).not.toThrow();
  });

  it("registers the knowledge import channel without a path argument", () => {
    expect(ALLOWED_CHANNELS.has(IPC_CHANNELS.KNOWLEDGE_IMPORT)).toBe(true);
    expect(() => assertAllowedChannel(IPC_CHANNELS.KNOWLEDGE_IMPORT)).not.toThrow();
  });

  it("registers the D24 update channels", () => {
    expect(ALLOWED_CHANNELS.has(IPC_CHANNELS.UPDATES_CHECK)).toBe(true);
    expect(ALLOWED_CHANNELS.has(IPC_CHANNELS.UPDATES_DOWNLOAD_INSTALL)).toBe(true);
    expect(() => assertAllowedChannel(IPC_CHANNELS.UPDATES_CHECK)).not.toThrow();
    expect(() => assertAllowedChannel(IPC_CHANNELS.UPDATES_DOWNLOAD_INSTALL)).not.toThrow();
  });

  it("registers the D22 language, tray, notification and chrome channels", () => {
    for (const channel of [
      IPC_CHANNELS.I18N_SET_LANGUAGE,
      IPC_CHANNELS.TRAY_SYNC,
      IPC_CHANNELS.NOTIFICATION_SHOW,
      IPC_CHANNELS.CHROME_SCAN,
      IPC_CHANNELS.CHROME_PREVIEW,
      IPC_CHANNELS.CHROME_IMPORT,
      IPC_CHANNELS.CHROME_STATE,
      IPC_CHANNELS.CHROME_CLEAR,
      IPC_CHANNELS.CHROME_EXPORT,
    ]) {
      expect(ALLOWED_CHANNELS.has(channel)).toBe(true);
      expect(() => assertAllowedChannel(channel)).not.toThrow();
    }
  });

  it("keeps the D22 event channels distinct from the invoke channels", () => {
    const events = [
      HOST_EVENT_MISSED,
      SYSTEM_EVENT_TRAY_ACTION,
      SYSTEM_EVENT_NOTIFICATION_CLICK,
      SYSTEM_EVENT_WINDOW_FOCUS,
    ];
    for (const channel of events) {
      expect(ALLOWED_CHANNELS.has(channel)).toBe(false);
      expect(() => assertAllowedChannel(channel)).toThrow(IpcDeniedError);
    }
  });

  it("rejects unknown channels with a stable error code", () => {
    try {
      assertAllowedChannel("shell:exec");
      expect.unreachable("expected throw");
    } catch (error) {
      expect(error).toBeInstanceOf(IpcDeniedError);
      expect((error as IpcDeniedError).code).toBe("UNKNOWN_CHANNEL");
    }
  });
});

describe("titlebar overlay payload validation", () => {
  it("accepts two #rrggbb colors", () => {
    expect(() =>
      assertValidTitleBarOverlayColors({ color: "#0f0f10", symbolColor: "#ececf1" }),
    ).not.toThrow();
    expect(() =>
      assertValidTitleBarOverlayColors({ color: "#f6f6f8", symbolColor: "#1a1a1e" }),
    ).not.toThrow();
  });

  it.each([
    ["non-object", "oops"],
    ["missing symbolColor", { color: "#0f0f10" }],
    ["named color", { color: "red", symbolColor: "#ececf1" }],
    ["short hex", { color: "#fff", symbolColor: "#ececf1" }],
    ["injection string", { color: "#0f0f10\"><script>", symbolColor: "#ececf1" }],
  ])("rejects %s with INVALID_PAYLOAD", (_label, payload) => {
    try {
      assertValidTitleBarOverlayColors(payload);
      expect.unreachable("expected throw");
    } catch (error) {
      expect(error).toBeInstanceOf(IpcDeniedError);
      expect((error as IpcDeniedError).code).toBe("INVALID_PAYLOAD");
    }
  });
});

describe("language preference payload validation", () => {
  it("accepts the three preferences the UI can persist", () => {
    for (const value of ["system", "zh", "en"]) {
      expect(() => assertValidLanguagePreference(value)).not.toThrow();
    }
  });

  it.each([
    ["unknown language", "fr"],
    ["wrong case", "ZH"],
    ["empty", ""],
    ["null", null],
    ["object payload", { preference: "zh" }],
  ])("rejects %s with INVALID_PAYLOAD", (_label, payload) => {
    try {
      assertValidLanguagePreference(payload);
      expect.unreachable("expected throw");
    } catch (error) {
      expect(error).toBeInstanceOf(IpcDeniedError);
      expect((error as IpcDeniedError).code).toBe("INVALID_PAYLOAD");
    }
  });
});

describe("IPC sender guard helpers", () => {
  it("rejects unauthorized senders with a stable error code", () => {
    const event = {} as IpcMainInvokeEvent;
    const deny = vi.fn(() => false);
    try {
      assertAuthorizedSender(event, deny);
      expect.unreachable("expected throw");
    } catch (error) {
      expect(error).toBeInstanceOf(IpcDeniedError);
      expect((error as IpcDeniedError).code).toBe("UNAUTHORIZED_SENDER");
    }
    expect(deny).toHaveBeenCalledOnce();
  });

  it("allows authorized senders", () => {
    const event = {} as IpcMainInvokeEvent;
    expect(() => assertAuthorizedSender(event, () => true)).not.toThrow();
  });
});
