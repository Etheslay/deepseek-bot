import { describe, expect, it, vi } from "vitest";
import {
  ALLOWED_CHANNELS,
  IPC_CHANNELS,
  IpcDeniedError,
  assertAllowedChannel,
} from "../src/shared/ipc-channels.js";
import { assertAuthorizedSender } from "../src/main/ipc/guards.js";
import type { IpcMainInvokeEvent } from "electron";

describe("IPC allowlist", () => {
  it("accepts only registered channels", () => {
    expect(ALLOWED_CHANNELS.has(IPC_CHANNELS.APP_GET_INFO)).toBe(true);
    expect(() => assertAllowedChannel(IPC_CHANNELS.APP_GET_INFO)).not.toThrow();
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
