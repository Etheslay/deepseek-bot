/** Local account photos. The renderer never receives a filesystem path. */

export const ACCOUNT_AVATAR_MAX_SOURCE_BYTES = 8 * 1024 * 1024;
export const ACCOUNT_AVATAR_EDGE = 256;
/** A 256px JPEG data URL stays well under this; anything larger is rejected. */
export const ACCOUNT_AVATAR_DATA_URL_MAX = 180_000;

export type AccountAvatarPickResult =
  | { ok: true; dataUrl: string }
  | { ok: false; code: "cancelled" | "read" | "format" | "size" };

export function avatarFileKind(bytes: Uint8Array): "png" | "jpeg" | "gif" | "webp" | null {
  if (bytes.length < 12) return null;
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return "gif";
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "webp";
  }
  return null;
}

const ACCOUNT_AVATAR_DATA_URL = /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/;

export function isAccountAvatarDataUrl(value: string): boolean {
  return value.length <= ACCOUNT_AVATAR_DATA_URL_MAX && ACCOUNT_AVATAR_DATA_URL.test(value);
}
