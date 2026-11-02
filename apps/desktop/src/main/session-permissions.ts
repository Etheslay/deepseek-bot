/**
 * Renderer session permissions granted by the shell.
 *
 * Clipboard write copies message text. Electron presents both microphone and
 * camera as `media`; device audio is `audio`, device video is `video`. Only
 * microphone audio is granted so hold-to-talk can call getUserMedia. Camera,
 * screen capture, notifications, clipboard read, and every other permission
 * stay denied.
 */

export function rendererPermissionAllowed(permission: string, details?: object): boolean {
  if (permission === "clipboard-sanitized-write") {
    return true;
  }
  if (permission !== "media" || details === undefined) {
    return false;
  }
  // Requests always set `mediaTypes` (audio, video, or both). Checks set
  // `mediaType` instead. Camera and unspecified media stay denied.
  if ("mediaTypes" in details) {
    const mediaTypes = (details as { mediaTypes?: unknown }).mediaTypes;
    return (
      Array.isArray(mediaTypes) &&
      mediaTypes.length > 0 &&
      mediaTypes.every((type) => type === "audio")
    );
  }
  return (details as { mediaType?: unknown }).mediaType === "audio";
}
