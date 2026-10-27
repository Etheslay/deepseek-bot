import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  bookmarkFileFor,
  chromeUserDataRoot,
  clearChromeImport,
  exportChromeImportToMarkdown,
  flattenChromeBookmarks,
  importChromeProfile,
  previewChromeProfile,
  readChromeImport,
  scanChromeProfilesIn,
} from "../../src/main/chrome-bookmarks.js";

const BOOKMARKS = {
  version: 1,
  roots: {
    bookmark_bar: {
      id: "1",
      name: "Bookmarks bar",
      type: "bar",
      children: [
        { id: "2", name: "DeepSeek", type: "url", url: "https://www.deepseek.com/" },
        {
          id: "3",
          name: "Docs",
          type: "folder",
          children: [
            { id: "4", name: "Harness", type: "url", url: "https://github.com/deepseek-ai/deepseek-harness" },
            // duplicate of #2 — must be de-duplicated
            { id: "5", name: "DeepSeek dup", type: "url", url: "https://www.deepseek.com/" },
            // executable target — must be refused
            { id: "6", name: "bait", type: "url", url: "javascript:alert(1)" },
            // local file — refused
            { id: "7", name: "local", type: "url", url: "file:///C:/secrets.txt" },
          ],
        },
      ],
    },
    other: {
      id: "10",
      name: "Other bookmarks",
      type: "folder",
      children: [{ id: "11", name: "Site", type: "url", url: "http://example.com/a" }],
    },
    synced: { id: "20", name: "Mobile bookmarks", type: "folder", children: [] },
  },
};

const SECOND = {
  roots: {
    bookmark_bar: {
      name: "Bookmarks bar",
      type: "bar",
      children: [{ name: "Only", type: "url", url: "https://only.example/" }],
    },
  },
};

let chromeRoot = "";
let dataRoot = "";

beforeAll(() => {
  const base = mkdtempSync(join(tmpdir(), "d22-chrome-"));
  chromeRoot = join(base, "User Data");
  dataRoot = join(base, "app-data");
  mkdirSync(join(chromeRoot, "Default"), { recursive: true });
  mkdirSync(join(chromeRoot, "Profile 1"), { recursive: true });
  mkdirSync(join(chromeRoot, "GuestProfile"), { recursive: true });
  mkdirSync(dataRoot, { recursive: true });
  writeFileSync(join(chromeRoot, "Default", "Bookmarks"), JSON.stringify(BOOKMARKS), "utf8");
  writeFileSync(join(chromeRoot, "Profile 1", "Bookmarks"), JSON.stringify(SECOND), "utf8");
  writeFileSync(
    join(chromeRoot, "Local State"),
    JSON.stringify({ profile: { info_cache: { Default: { name: "工作电脑" }, "Profile 1": { name: "个人" } } } }),
    "utf8",
  );
});

afterAll(() => {
  rmSync(join(chromeRoot, ".."), { recursive: true, force: true });
});

describe("chrome bookmark parsing", () => {
  it("keeps only http(s) entries, de-duplicates and records the folder path", () => {
    const items = flattenChromeBookmarks(BOOKMARKS);
    expect(items.map((item) => item.url)).toEqual([
      "https://www.deepseek.com/",
      "https://github.com/deepseek-ai/deepseek-harness",
      "http://example.com/a",
    ]);
    expect(items[0]?.folder).toBe("Bookmarks bar");
    expect(items[1]?.folder).toBe("Bookmarks bar/Docs");
    expect(items[2]?.folder).toBe("Other bookmarks");
  });

  it("survives garbage input without throwing", () => {
    expect(flattenChromeBookmarks(null)).toEqual([]);
    expect(flattenChromeBookmarks({})).toEqual([]);
    expect(flattenChromeBookmarks({ roots: { bookmark_bar: { children: "nope" } } })).toEqual([]);
  });

  it("uses Chrome's own profile names and only lists profiles that have bookmarks", () => {
    const scan = scanChromeProfilesIn(chromeRoot);
    expect(scan.error).toBeNull();
    expect(scan.found).toBe(true);
    expect(scan.profiles.map((profile) => [profile.token, profile.name, profile.bookmarkCount])).toEqual([
      ["Default", "工作电脑", 3],
      ["Profile 1", "个人", 1],
    ]);
  });

  it("reports no chrome when the root does not exist", () => {
    const scan = scanChromeProfilesIn(join(chromeRoot, "absent"));
    expect(scan.found).toBe(false);
    expect(scan.profiles).toEqual([]);
  });

  it("reports an unusable path instead of pretending a profile list", () => {
    expect(scanChromeProfilesIn(null)).toEqual({
      found: false,
      rootPath: "",
      profiles: [],
      error: "chrome data path is not resolvable",
    });
  });
});

describe("chrome path safety", () => {
  it.each([
    ["Default", true],
    ["Profile 1", true],
    ["../Default", false],
    ["..", false],
    ["", false],
    ["Default/Bookmarks", false],
    ["C:/Windows", false],
  ])("token %s resolves to a bookmarks file: %s", (token, allowed) => {
    const resolved = bookmarkFileFor(chromeRoot, token);
    if (allowed) {
      expect(resolved).toBe(join(chromeRoot, token, "Bookmarks"));
    } else {
      expect(resolved).toBeNull();
    }
  });

  it("finds Chrome's data root per platform", () => {
    expect(
      chromeUserDataRoot("win32", { LOCALAPPDATA: "C:/Users/me/AppData/Local" }, "C:/Users/me"),
    ).toBe(join("C:/Users/me/AppData/Local", "Google", "Chrome", "User Data"));
    expect(chromeUserDataRoot("win32", { USERPROFILE: "C:/Users/me" }, "C:/Users/me")).toBe(
      join("C:/Users/me/AppData/Local", "Google", "Chrome", "User Data"),
    );
    expect(chromeUserDataRoot("win32", {}, "")).toBeNull();
    // join() is platform-shaped on purpose: the point is the location, not separators.
    expect(chromeUserDataRoot("linux", {}, "/home/me")).toBe(
      join("/home/me", ".config", "google-chrome", "Default"),
    );
    expect(chromeUserDataRoot("darwin", {}, "/Users/me")).toBe(
      join("/Users/me", "Library", "Application Support", "Google", "Chrome", "Default"),
    );
  });
});

describe("chrome import into the app data root", () => {
  it("previews without writing anything", () => {
    const preview = previewChromeProfile("Default", { root: chromeRoot });
    expect(preview.profile?.name).toBe("工作电脑");
    expect(preview.total).toBe(3);
    expect(preview.samples).toHaveLength(3);
    expect(readChromeImport(dataRoot).imported).toBe(0);
  });

  it("rejects an unknown profile token", () => {
    expect(previewChromeProfile("GuestProfile", { root: chromeRoot }).error).toBe("unknown chrome profile");
    expect(importChromeProfile(dataRoot, "GuestProfile", { root: chromeRoot }).error).toBe(
      "unknown chrome profile",
    );
  });

  it("imports, reads back, exports and clears", () => {
    const result = importChromeProfile(dataRoot, "Default", { root: chromeRoot });
    expect(result.error).toBeNull();
    expect(result.imported).toBe(3);
    expect(result.profileName).toBe("工作电脑");

    const state = readChromeImport(dataRoot);
    expect(state.imported).toBe(3);
    expect(state.samples[0]?.url).toBe("https://www.deepseek.com/");

    const exported = exportChromeImportToMarkdown(dataRoot);
    expect("error" in exported).toBe(false);
    if ("filePath" in exported) {
      const markdown = readFileSync(exported.filePath, "utf8");
      expect(markdown).toContain("# Chrome bookmarks (工作电脑)");
      expect(markdown).toContain("## Bookmarks bar/Docs");
      expect(markdown).toContain("- [Harness](https://github.com/deepseek-ai/deepseek-harness)");
      // Nothing executable or local leaks into the export.
      expect(markdown).not.toContain("javascript:");
      expect(markdown).not.toContain("file:///");
    }

    expect(clearChromeImport(dataRoot)).toEqual({ cleared: true });
    expect(readChromeImport(dataRoot).imported).toBe(0);
    expect("error" in exportChromeImportToMarkdown(dataRoot)).toBe(true);
  });

  it("reads a corrupt import as empty rather than crashing the panel", () => {
    const dir = join(dataRoot, "imports", "chrome");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "bookmarks.json"), "{not json", "utf8");
    expect(readChromeImport(dataRoot)).toEqual({
      imported: 0,
      importedAt: null,
      profileName: null,
      filePath: null,
      samples: [],
    });
  });
});
