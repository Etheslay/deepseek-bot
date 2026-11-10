/**
 * Open a link from a chat reply outside this window.
 * Web and mail go to the system handler. A file opens only when it is a
 * real file inside the bot workspace — the app window never loads it.
 */
import { shell } from "electron";
import { realpathSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  parseChatLinkHref,
  resolveWorkspaceFile,
  type ChatLinkOpenResult,
} from "../shared/chat-link.js";

export async function openDesktopChatLink(
  dataRoot: string,
  href: string,
): Promise<ChatLinkOpenResult> {
  const link = parseChatLinkHref(href);
  if (link === null) {
    return { ok: false, reason: "blocked" };
  }
  if (link.kind === "web" || link.kind === "mail") {
    try {
      await shell.openExternal(link.href);
      return { ok: true };
    } catch {
      return { ok: false, reason: "blocked" };
    }
  }
  const opened = resolveWorkspaceFile(join(dataRoot, "workspace"), link.path, {
    realpath: (path) => {
      try {
        return realpathSync(path);
      } catch {
        return null;
      }
    },
    kind: (path) => {
      try {
        return statSync(path).isFile() ? "file" : "other";
      } catch {
        return "other";
      }
    },
  });
  if (opened === "missing") {
    return { ok: false, reason: "missing" };
  }
  if (opened === "outside") {
    return { ok: false, reason: "outside" };
  }
  const error = await shell.openPath(opened);
  return error === "" ? { ok: true } : { ok: false, reason: "missing" };
}
