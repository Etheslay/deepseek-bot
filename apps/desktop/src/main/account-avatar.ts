/** User-picked account picture. The renderer cannot supply the path. */
import { dialog, nativeImage, type BrowserWindow, type NativeImage } from "electron";
import { open } from "node:fs/promises";
import { tr } from "./i18n.js";
import {
  ACCOUNT_AVATAR_EDGE,
  ACCOUNT_AVATAR_MAX_SOURCE_BYTES,
  avatarFileKind,
  isAccountAvatarDataUrl,
  type AccountAvatarPickResult,
} from "../shared/account-avatar.js";

/**
 * Opens a picture picker, center-crops it, and returns a small JPEG data URL.
 * The chosen path stays in this process.
 */
export async function pickAccountAvatar(parent: BrowserWindow): Promise<AccountAvatarPickResult> {
  const picked = await dialog.showOpenDialog(parent, {
    title: tr("main.pickAccountAvatar"),
    properties: ["openFile"],
    filters: [
      { name: tr("main.imageFilesFilter"), extensions: ["png", "jpg", "jpeg", "webp", "gif"] },
      { name: tr("main.allFilesFilter"), extensions: ["*"] },
    ],
  });
  if (picked.canceled || picked.filePaths.length !== 1) return { ok: false, code: "cancelled" };
  const filePath = picked.filePaths[0];
  if (filePath === undefined) return { ok: false, code: "cancelled" };
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(filePath, "r");
    const stat = await handle.stat();
    if (!stat.isFile()) return { ok: false, code: "read" };
    if (stat.size > ACCOUNT_AVATAR_MAX_SOURCE_BYTES) return { ok: false, code: "size" };
    const bytes = Buffer.alloc(stat.size);
    if (stat.size > 0) {
      const read = await handle.read(bytes, 0, stat.size, 0);
      if (read.bytesRead !== stat.size) return { ok: false, code: "read" };
    }
    if (avatarFileKind(bytes) === null) return { ok: false, code: "format" };
    const jpeg = squareJpeg(nativeImage.createFromBuffer(bytes));
    if (jpeg === null) return { ok: false, code: "format" };
    const dataUrl = `data:image/jpeg;base64,${jpeg.toString("base64")}`;
    if (!isAccountAvatarDataUrl(dataUrl)) return { ok: false, code: "size" };
    return { ok: true, dataUrl };
  } catch {
    return { ok: false, code: "read" };
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function squareJpeg(image: NativeImage): Buffer | null {
  if (image.isEmpty()) return null;
  const { width, height } = image.getSize();
  if (width < 1 || height < 1) return null;
  const side = Math.min(width, height);
  const cropped = image.crop({
    x: Math.floor((width - side) / 2),
    y: Math.floor((height - side) / 2),
    width: side,
    height: side,
  });
  const jpeg = cropped
    .resize({ width: ACCOUNT_AVATAR_EDGE, height: ACCOUNT_AVATAR_EDGE, quality: "best" })
    .toJPEG(82);
  return jpeg.byteLength > 0 ? jpeg : null;
}
