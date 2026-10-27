/**
 * System notifications (D22).
 *
 * Main owns the platform channel (Electron `Notification`), the renderer owns
 * the policy: master switch, "only when the window is not focused", per-bot
 * mute and the throttling all live there because that is where the bot list and
 * the focus state are. Main therefore stays dumb — it validates, de-duplicates
 * a storm of identical notices, raises the notification and reports the click.
 *
 * Windows needs an AppUserModelId on the shortcut/launch path (set in
 * `main/index.ts`); where the platform has no channel, `isSupported()` is false
 * and the caller is told the reason instead of silently dropping the notice.
 */
import { Notification, nativeImage, type BrowserWindow } from "electron";
import { SYSTEM_EVENT_NOTIFICATION_CLICK, type NotificationClickEvent } from "../shared/ipc-channels.js";
import type { NotificationOutcome, NotificationRequest } from "../shared/system-integration.js";

export type { NotificationOutcome } from "../shared/system-integration.js";

/** Identical title+body inside this window is treated as a burst, not twice. */
export const NOTIFICATION_DEDUPE_MS = 4_000;

export function createNotificationController(deps: {
  getWindow: () => BrowserWindow | null;
  send: (event: NotificationClickEvent) => void;
  now?: () => number;
}): {
  show: (request: NotificationRequest) => NotificationOutcome;
  isSupported: () => boolean;
} {
  const now = deps.now ?? (() => Date.now());
  const recent = new Map<string, number>();

  const prune = (): void => {
    const cutoff = now() - NOTIFICATION_DEDUPE_MS;
    for (const [key, at] of recent) {
      if (at < cutoff) {
        recent.delete(key);
      }
    }
  };

  return {
    isSupported: () => Notification.isSupported(),
    show: (request: NotificationRequest): NotificationOutcome => {
      if (!Notification.isSupported()) {
        return { shown: false, reason: "unsupported" };
      }
      prune();
      const key = `${request.botId ?? ""}|${request.title}|${request.body}`;
      const last = recent.get(key);
      if (last !== undefined && now() - last < NOTIFICATION_DEDUPE_MS) {
        return { shown: false, reason: "duplicate" };
      }
      recent.set(key, now());

      const image =
        request.icon === null ? undefined : nativeImage.createFromDataURL(request.icon);
      const notification = new Notification({
        title: request.title,
        body: request.body,
        silent: request.silent,
        // exactOptionalPropertyTypes: an absent icon must not be passed as undefined.
        ...(image !== undefined && !image.isEmpty() ? { icon: image } : {}),
      });
      notification.on("click", () => {
        const win = deps.getWindow();
        win?.show();
        win?.focus();
        deps.send({ botId: request.botId });
      });
      notification.show();
      return { shown: true, reason: null };
    },
  };
}

/** Raises a notification in the live window's context and forwards its click. */
export function sendNotificationClick(win: BrowserWindow | null, event: NotificationClickEvent): void {
  if (win !== null && !win.isDestroyed()) {
    win.webContents.send(SYSTEM_EVENT_NOTIFICATION_CLICK, event);
  }
}
