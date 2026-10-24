import type { BrowserWindow, IpcMainInvokeEvent } from "electron";
import { IpcDeniedError } from "../../shared/ipc-channels.js";

export type SenderGuard = (event: IpcMainInvokeEvent) => boolean;

/**
 * Returns true when the invoke comes from the primary shell window's main frame.
 */
export function createPrimaryWindowSenderGuard(
  getMainWindow: () => BrowserWindow | null,
): SenderGuard {
  return (event: IpcMainInvokeEvent): boolean => {
    const main = getMainWindow();
    if (!main || main.isDestroyed()) {
      return false;
    }
    if (event.sender !== main.webContents) {
      return false;
    }
    const frame = event.senderFrame;
    if (!frame || frame !== main.webContents.mainFrame) {
      return false;
    }
    return true;
  };
}

export function assertAuthorizedSender(
  event: IpcMainInvokeEvent,
  isAuthorized: SenderGuard,
): void {
  if (!isAuthorized(event)) {
    throw new IpcDeniedError(
      "UNAUTHORIZED_SENDER",
      "IPC sender is not the primary renderer frame",
    );
  }
}
