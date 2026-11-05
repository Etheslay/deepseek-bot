/**
 * Desktop sidebar width. The renderer keeps this preference in localStorage,
 * next to theme and other shell settings. It is not part of the Host UI-state
 * snapshot: that row is order and selection only.
 *
 * The stored value is the width the user chose. A narrow window shows a
 * smaller width without overwriting the stored one, so a later wider window
 * restores it.
 */
export const SIDEBAR_WIDTH_STORAGE_KEY = "deepseek-bot.sidebar-width.v1";

/** Matches the fixed width the shell CSS used before dragging was added. */
export const SIDEBAR_WIDTH_DEFAULT = 300;

/** Wide enough for the avatar, a short name, and the footer account row. */
export const SIDEBAR_WIDTH_MIN = 220;

/** Stops the list column from taking over the chat. */
export const SIDEBAR_WIDTH_MAX = 480;

/**
 * Horizontal room left for the conversation column. The visible width also
 * stays at most half the window.
 */
export const SIDEBAR_CONTENT_RESERVE = 420;

export const SIDEBAR_WIDTH_STEP = 16;

export function clampSidebarWidth(value: number): number {
  if (!Number.isFinite(value)) {
    return SIDEBAR_WIDTH_DEFAULT;
  }
  return Math.round(Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, value)));
}

/** Largest width the current window can show without crushing the chat. */
export function sidebarWidthLimit(viewportWidth: number): number {
  if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) {
    return SIDEBAR_WIDTH_MAX;
  }
  const cap = Math.min(
    SIDEBAR_WIDTH_MAX,
    Math.floor(viewportWidth - SIDEBAR_CONTENT_RESERVE),
    Math.floor(viewportWidth / 2),
  );
  return Math.max(SIDEBAR_WIDTH_MIN, cap);
}

export function displaySidebarWidth(persisted: number, viewportWidth: number): number {
  return Math.min(clampSidebarWidth(persisted), sidebarWidthLimit(viewportWidth));
}

/** Width while dragging. `deltaX` is the pointer's movement from pointerdown. */
export function sidebarWidthFromDrag(
  startWidth: number,
  deltaX: number,
  viewportWidth: number,
): number {
  return displaySidebarWidth(startWidth + deltaX, viewportWidth);
}

/**
 * Keyboard adjustment of the visible width. Returns null for keys that do
 * not resize. Home and End use the current window's min and max.
 */
export function sidebarWidthFromKey(
  current: number,
  key: string,
  viewportWidth: number,
  shiftKey = false,
): number | null {
  const step = shiftKey ? SIDEBAR_WIDTH_STEP * 2 : SIDEBAR_WIDTH_STEP;
  switch (key) {
    case "ArrowLeft":
    case "ArrowDown":
      return displaySidebarWidth(current - step, viewportWidth);
    case "ArrowRight":
    case "ArrowUp":
      return displaySidebarWidth(current + step, viewportWidth);
    case "Home":
      return SIDEBAR_WIDTH_MIN;
    case "End":
      return sidebarWidthLimit(viewportWidth);
    default:
      return null;
  }
}

export function loadSidebarWidth(storage: Storage): number {
  try {
    const raw = storage.getItem(SIDEBAR_WIDTH_STORAGE_KEY);
    if (raw === null || raw.trim() === "") {
      return SIDEBAR_WIDTH_DEFAULT;
    }
    return clampSidebarWidth(Number(raw));
  } catch {
    return SIDEBAR_WIDTH_DEFAULT;
  }
}

export function saveSidebarWidth(storage: Storage, width: number): number {
  const next = clampSidebarWidth(width);
  try {
    storage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(next));
  } catch {
    // Quota or private mode: the width still applies for this session.
  }
  return next;
}
