import { describe, expect, it, vi } from "vitest";
import {
  ALLOWED_CHANNELS,
  IPC_CHANNELS,
  IpcDeniedError,
  assertAllowedChannel,
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

  it("registers the D24 update channels", () => {
    expect(ALLOWED_CHANNELS.has(IPC_CHANNELS.UPDATES_CHECK)).toBe(true);
    expect(ALLOWED_CHANNELS.has(IPC_CHANNELS.UPDATES_DOWNLOAD_INSTALL)).toBe(true);
    expect(() => assertAllowedChannel(IPC_CHANNELS.UPDATES_CHECK)).not.toThrow();
    expect(() => assertAllowedChannel(IPC_CHANNELS.UPDATES_DOWNLOAD_INSTALL)).not.toThrow();
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
