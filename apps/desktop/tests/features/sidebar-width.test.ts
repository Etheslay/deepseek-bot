import { describe, expect, it } from "vitest";
import {
  SIDEBAR_WIDTH_DEFAULT,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
  SIDEBAR_WIDTH_STORAGE_KEY,
  clampSidebarWidth,
  displaySidebarWidth,
  loadSidebarWidth,
  saveSidebarWidth,
  sidebarWidthFromDrag,
  sidebarWidthFromKey,
  sidebarWidthLimit,
} from "../../src/renderer/src/features/shell/sidebar-width.js";

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(initial));
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => (map.has(key) ? (map.get(key) as string) : null),
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => {
      map.delete(key);
    },
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
  };
}

describe("sidebar width", () => {
  it("uses the previous fixed width when nothing is stored", () => {
    expect(loadSidebarWidth(memoryStorage())).toBe(SIDEBAR_WIDTH_DEFAULT);
    expect(SIDEBAR_WIDTH_DEFAULT).toBe(300);
  });

  it("clamps to a sensible min and max and rounds to whole pixels", () => {
    expect(clampSidebarWidth(10)).toBe(SIDEBAR_WIDTH_MIN);
    expect(clampSidebarWidth(900)).toBe(SIDEBAR_WIDTH_MAX);
    expect(clampSidebarWidth(360.4)).toBe(360);
    expect(clampSidebarWidth(Number.NaN)).toBe(SIDEBAR_WIDTH_DEFAULT);
    expect(SIDEBAR_WIDTH_MIN).toBeGreaterThanOrEqual(200);
    expect(SIDEBAR_WIDTH_MAX).toBeGreaterThan(SIDEBAR_WIDTH_DEFAULT);
    expect(SIDEBAR_WIDTH_MAX).toBeLessThanOrEqual(560);
  });

  it("persists the chosen width and ignores corrupt values", () => {
    const storage = memoryStorage();
    expect(saveSidebarWidth(storage, 412.2)).toBe(412);
    expect(storage.getItem(SIDEBAR_WIDTH_STORAGE_KEY)).toBe("412");
    expect(loadSidebarWidth(storage)).toBe(412);

    expect(loadSidebarWidth(memoryStorage({ [SIDEBAR_WIDTH_STORAGE_KEY]: "nope" }))).toBe(
      SIDEBAR_WIDTH_DEFAULT,
    );
    expect(loadSidebarWidth(memoryStorage({ [SIDEBAR_WIDTH_STORAGE_KEY]: "" }))).toBe(
      SIDEBAR_WIDTH_DEFAULT,
    );
    expect(loadSidebarWidth(memoryStorage({ [SIDEBAR_WIDTH_STORAGE_KEY]: "80" }))).toBe(
      SIDEBAR_WIDTH_MIN,
    );
    expect(loadSidebarWidth(memoryStorage({ [SIDEBAR_WIDTH_STORAGE_KEY]: "2000" }))).toBe(
      SIDEBAR_WIDTH_MAX,
    );
  });

  it("keeps a stored width when the storage write throws", () => {
    const storage = memoryStorage();
    storage.setItem = () => {
      throw new Error("quota");
    };
    expect(saveSidebarWidth(storage, 360)).toBe(360);
    expect(storage.getItem(SIDEBAR_WIDTH_STORAGE_KEY)).toBeNull();
  });

  it("reads a throwing storage as the default", () => {
    const storage = memoryStorage();
    storage.getItem = () => {
      throw new Error("denied");
    };
    expect(loadSidebarWidth(storage)).toBe(SIDEBAR_WIDTH_DEFAULT);
  });

  it("shrinks the visible width on a narrow window without changing the cap math", () => {
    expect(displaySidebarWidth(420, 1600)).toBe(420);
    expect(displaySidebarWidth(420, 800)).toBeLessThan(420);
    expect(displaySidebarWidth(420, 800)).toBeGreaterThanOrEqual(SIDEBAR_WIDTH_MIN);
    expect(sidebarWidthLimit(640)).toBe(SIDEBAR_WIDTH_MIN);
    expect(sidebarWidthLimit(1600)).toBe(SIDEBAR_WIDTH_MAX);
    expect(displaySidebarWidth(10, 1600)).toBe(SIDEBAR_WIDTH_MIN);
  });

  it("tracks a drag and stops at the window limit", () => {
    expect(sidebarWidthFromDrag(300, 40, 1600)).toBe(340);
    expect(sidebarWidthFromDrag(300, -200, 1600)).toBe(SIDEBAR_WIDTH_MIN);
    expect(sidebarWidthFromDrag(300, 400, 1600)).toBe(SIDEBAR_WIDTH_MAX);
    const narrow = sidebarWidthLimit(760);
    expect(sidebarWidthFromDrag(300, 80, 760)).toBe(narrow);
  });

  it("resizes from the keyboard and ignores unrelated keys", () => {
    expect(sidebarWidthFromKey(300, "ArrowRight", 1600)).toBe(316);
    expect(sidebarWidthFromKey(300, "ArrowLeft", 1600)).toBe(284);
    expect(sidebarWidthFromKey(300, "ArrowRight", 1600, true)).toBe(332);
    expect(sidebarWidthFromKey(300, "Home", 1600)).toBe(SIDEBAR_WIDTH_MIN);
    expect(sidebarWidthFromKey(300, "End", 1600)).toBe(SIDEBAR_WIDTH_MAX);
    expect(sidebarWidthFromKey(300, "Enter", 1600)).toBeNull();
    expect(sidebarWidthFromKey(SIDEBAR_WIDTH_MIN, "ArrowLeft", 1600)).toBe(SIDEBAR_WIDTH_MIN);
  });
});
