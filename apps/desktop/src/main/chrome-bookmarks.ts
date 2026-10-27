/**
 * Chrome bookmark import (D22, read-only).
 *
 * Scope decision, recorded in the D22 report: the reference product imports a
 * browser's *signed-in session* so its cloud browser can browse logged-in sites.
 * This app has no browser automation and no cloud, so the useful local
 * equivalent is the bookmark tree — plain JSON, no cookie vault, no history
 * database. Cookies, passwords, payment data and History are never read
 * (FR-19 boundary, SECURITY_DATA §4).
 *
 * Everything stays on this machine: profile directories are discovered under the
 * user's own Chrome data path, `Bookmarks` is read, and the selected subset is
 * written into the app's data root where the user can inspect, export or delete
 * it. `root` is injectable so the parsing and file handling are unit-testable
 * without touching a real Chrome profile.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, isAbsolute, join, resolve, sep } from "node:path";
import {
  CHROME_IMPORT_MAX,
  CHROME_PREVIEW_MAX,
  type ChromeBookmarkItem,
  type ChromeClearResult,
  type ChromeExportResult,
  type ChromeImportResult,
  type ChromePreviewResult,
  type ChromeProfileSummary,
  type ChromeScanResult,
  type ChromeStateResult,
} from "../shared/system-integration.js";

/** A bookmarks file larger than this is not a bookmark tree worth inlining. */
const MAX_BOOKMARK_FILE_BYTES = 8 * 1024 * 1024;
/**
 * Profile directory names are the only path component this module accepts —
 * `Default`, `Profile 1`, … . Separators and `..` are excluded by construction.
 */
const SAFE_TOKEN = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,79}$/;

export type ChromeScanOptions = {
  /** Overrides the discovered Chrome "User Data" root (tests, portable installs). */
  root?: string | null;
};

export type ChromeImportStore = {
  importedAt: string;
  profileName: string;
  profileToken: string;
  items: ChromeBookmarkItem[];
};

/**
 * Chrome's profile root. Windows first (the shipped platform); the other two are
 * best-effort so the module does not silently look in the wrong place if the app
 * ever runs there.
 */
export function chromeUserDataRoot(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  home = homedir(),
): string | null {
  if (platform === "win32") {
    const local =
      env["LOCALAPPDATA"] ?? (env["USERPROFILE"] ? join(env["USERPROFILE"], "AppData", "Local") : null);
    if (local === null || local.length === 0) {
      return null;
    }
    return join(local, "Google", "Chrome", "User Data");
  }
  if (platform === "darwin") {
    return join(home, "Library", "Application Support", "Google", "Chrome", "Default");
  }
  return join(home, ".config", "google-chrome", "Default");
}

type ChromeNode = {
  type?: string;
  name?: string;
  url?: string;
  children?: ChromeNode[];
};

/**
 * Flatten the three bookmark roots. Only `http(s)` URLs survive: `javascript:`,
 * `data:`, `file:` and `chrome://` entries are skipped so an imported list can
 * never carry an executable or a local path into the app.
 */
export function flattenChromeBookmarks(raw: unknown): ChromeBookmarkItem[] {
  const roots = (raw as { roots?: Record<string, ChromeNode> } | null)?.roots;
  if (typeof roots !== "object" || roots === null) {
    return [];
  }
  const items: ChromeBookmarkItem[] = [];
  const seen = new Set<string>();
  const visit = (node: ChromeNode, folder: string): void => {
    if (items.length >= CHROME_IMPORT_MAX) {
      return;
    }
    if (node.type === "url" && typeof node.url === "string") {
      const url = node.url.trim();
      if (!/^https?:\/\//i.test(url) || seen.has(url)) {
        return;
      }
      seen.add(url);
      items.push({
        name: (typeof node.name === "string" && node.name.trim().length > 0 ? node.name : url).slice(0, 200),
        url: url.slice(0, 2_048),
        folder,
      });
      return;
    }
    for (const child of node.children ?? []) {
      const name = typeof node.name === "string" ? node.name : "";
      // The root nodes carry structural names ("bookmark_bar") that the labels
      // below already express, so only real folders extend the path.
      const next = name.length === 0 || folder === name ? folder : `${folder}/${name}`;
      visit(child, next);
    }
  };
  const labels: Record<string, string> = {
    bookmark_bar: "Bookmarks bar",
    other: "Other bookmarks",
    synced: "Mobile bookmarks",
  };
  for (const [key, node] of Object.entries(roots)) {
    if (typeof node === "object" && node !== null) {
      visit(node, labels[key] ?? key);
    }
  }
  return items;
}

/** Display names come from Chrome's own Local State; the directory is the fallback. */
function profileNames(root: string): Map<string, string> {
  const names = new Map<string, string>();
  try {
    const raw = JSON.parse(readFileSync(join(root, "Local State"), "utf8")) as {
      profile?: { info_cache?: Record<string, { name?: string }> };
    };
    for (const [directory, info] of Object.entries(raw.profile?.info_cache ?? {})) {
      if (typeof info?.name === "string" && info.name.trim().length > 0) {
        names.set(directory, info.name.trim().slice(0, 80));
      }
    }
  } catch {
    // No readable Local State: directory names still identify the profiles.
  }
  return names;
}

function readBookmarkFile(path: string): { items: ChromeBookmarkItem[]; error: string | null } {
  try {
    const size = statSync(path).size;
    if (size > MAX_BOOKMARK_FILE_BYTES) {
      return { items: [], error: `bookmarks file is larger than ${MAX_BOOKMARK_FILE_BYTES} bytes` };
    }
    return { items: flattenChromeBookmarks(JSON.parse(readFileSync(path, "utf8"))), error: null };
  } catch (error) {
    return { items: [], error: error instanceof Error ? error.message : String(error) };
  }
}

function profileDirectories(root: string): string[] {
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && SAFE_TOKEN.test(entry.name))
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

/** Every profile under `root` that has a readable Bookmarks file. */
export function scanChromeProfilesIn(root: string | null): ChromeScanResult {
  if (root === null || root.length === 0) {
    return { found: false, rootPath: "", profiles: [], error: "chrome data path is not resolvable" };
  }
  if (!existsSync(root)) {
    return { found: false, rootPath: root, profiles: [], error: null };
  }
  const names = profileNames(root);
  const profiles: ChromeProfileSummary[] = [];
  for (const directory of profileDirectories(root).sort()) {
    const file = join(root, directory, "Bookmarks");
    if (!existsSync(file)) {
      continue;
    }
    const { items, error } = readBookmarkFile(file);
    if (error !== null) {
      // A profile whose bookmarks cannot be parsed is reported as absent rather
      // than half-read: the user is never shown a count they did not get.
      continue;
    }
    profiles.push({
      directory,
      name: names.get(directory) ?? (directory === "Default" ? "Chrome" : directory),
      bookmarkCount: items.length,
      token: directory,
    });
  }
  return { found: profiles.length > 0, rootPath: root, profiles, error: null };
}

export function scanChromeProfiles(options: ChromeScanOptions = {}): ChromeScanResult {
  return scanChromeProfilesIn(options.root ?? chromeUserDataRoot());
}

/**
 * Resolve a profile token to its Bookmarks file, refusing anything that is not a
 * single safe directory name inside the root (no `..`, no absolute paths).
 */
export function bookmarkFileFor(root: string, token: string): string | null {
  if (!SAFE_TOKEN.test(token) || token.includes("..") || isAbsolute(token) || token.includes(sep)) {
    return null;
  }
  const base = resolve(root);
  const file = resolve(join(base, token, "Bookmarks"));
  if (!file.startsWith(base + sep) || basename(file) !== "Bookmarks") {
    return null;
  }
  return existsSync(file) ? file : null;
}

export function importPathFor(dataRoot: string): string {
  return join(dataRoot, "imports", "chrome", "bookmarks.json");
}

export function previewChromeProfile(token: string, options: ChromeScanOptions = {}): ChromePreviewResult {
  const scan = scanChromeProfiles(options);
  const profile = scan.profiles.find((entry) => entry.token === token) ?? null;
  if (profile === null) {
    return { profile: null, total: 0, samples: [], error: "unknown chrome profile" };
  }
  const file = bookmarkFileFor(scan.rootPath, token);
  if (file === null) {
    return { profile, total: 0, samples: [], error: "bookmarks file is not readable" };
  }
  const { items, error } = readBookmarkFile(file);
  return { profile, total: items.length, samples: items.slice(0, CHROME_PREVIEW_MAX), error };
}

export function importChromeProfile(
  dataRoot: string,
  token: string,
  options: ChromeScanOptions = {},
): ChromeImportResult {
  const empty: ChromeImportResult = {
    imported: 0,
    importedAt: "",
    profileName: "",
    filePath: "",
    error: null,
  };
  const scan = scanChromeProfiles(options);
  const profile = scan.profiles.find((entry) => entry.token === token) ?? null;
  if (profile === null) {
    return { ...empty, error: "unknown chrome profile" };
  }
  const file = bookmarkFileFor(scan.rootPath, token);
  if (file === null) {
    return { ...empty, error: "bookmarks file is not readable" };
  }
  const { items, error } = readBookmarkFile(file);
  if (error !== null) {
    return { ...empty, error };
  }
  const store: ChromeImportStore = {
    importedAt: new Date().toISOString(),
    profileName: profile.name,
    profileToken: profile.token,
    items,
  };
  const target = importPathFor(dataRoot);
  try {
    mkdirSync(join(dataRoot, "imports", "chrome"), { recursive: true });
    writeFileSync(target, JSON.stringify(store, null, 2), "utf8");
  } catch (cause) {
    return { ...empty, error: cause instanceof Error ? cause.message : String(cause) };
  }
  return {
    imported: items.length,
    importedAt: store.importedAt,
    profileName: profile.name,
    filePath: target,
    error: null,
  };
}

export function readChromeImport(dataRoot: string): ChromeStateResult {
  const target = importPathFor(dataRoot);
  try {
    const store = JSON.parse(readFileSync(target, "utf8")) as ChromeImportStore;
    const items = Array.isArray(store.items) ? store.items : [];
    return {
      imported: items.length,
      importedAt: typeof store.importedAt === "string" ? store.importedAt : null,
      profileName: typeof store.profileName === "string" ? store.profileName : null,
      filePath: target,
      samples: items.slice(0, CHROME_PREVIEW_MAX),
    };
  } catch {
    return { imported: 0, importedAt: null, profileName: null, filePath: null, samples: [] };
  }
}

export function clearChromeImport(dataRoot: string): ChromeClearResult {
  const directory = join(dataRoot, "imports", "chrome");
  try {
    rmSync(directory, { recursive: true, force: true });
    return { cleared: true };
  } catch {
    return { cleared: false };
  }
}

/** Markdown digest of the imported bookmarks, written next to the JSON. */
export function exportChromeImportToMarkdown(dataRoot: string): ChromeExportResult {
  const state = readChromeImport(dataRoot);
  if (state.imported === 0 || state.filePath === null) {
    return { error: "nothing imported yet" };
  }
  const store = JSON.parse(readFileSync(state.filePath, "utf8")) as ChromeImportStore;
  const lines = [`# Chrome bookmarks (${store.profileName})`, "", `Imported: ${store.importedAt}`];
  let folder = "";
  for (const item of store.items) {
    if (item.folder !== folder) {
      folder = item.folder;
      lines.push("", `## ${folder.length > 0 ? folder : "Bookmarks"}`, "");
    }
    lines.push(`- [${item.name}](${item.url})`);
  }
  const target = join(dataRoot, "imports", "chrome", "bookmarks.md");
  try {
    writeFileSync(target, lines.join("\n"), "utf8");
  } catch (cause) {
    return { error: cause instanceof Error ? cause.message : String(cause) };
  }
  return { filePath: target, items: store.items.length };
}
