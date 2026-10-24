/**
 * Data root resolution and directory layout (docs/SECURITY_DATA.md §2).
 *
 * The root comes from platform conventions, never a hardcoded user name:
 * callers in Electron pass `app.getPath("appData")`; plain Node hosts read
 * `%APPDATA%`. An explicit override (option or env var) exists for tests and
 * development only.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { invalidInput, storageErrorFromFsError } from "./errors.js";

export const DATA_ROOT_DIR_NAME = "DeepSeekBot";
export const DATA_ROOT_ENV_VAR = "DEEPSEEK_BOT_DATA_ROOT";

/** The on-disk layout under the data root. All paths are absolute. */
export interface DataLayout {
  readonly root: string;
  readonly dbFile: string;
  readonly harnessHome: string;
  readonly artifacts: string;
  readonly backups: string;
  readonly logs: string;
  readonly cache: string;
  readonly credentials: string;
}

/**
 * Resolve the data root without touching the filesystem.
 *
 * Precedence: explicit option → `DEEPSEEK_BOT_DATA_ROOT` → platform app-data
 * dir. Throws instead of guessing when no platform dir is available.
 */
export function resolveDataRoot(options?: { appDataDir?: string }): string {
  const explicit = options?.appDataDir ?? process.env[DATA_ROOT_ENV_VAR];
  if (explicit !== undefined && explicit !== "") {
    return normalizeRoot(explicit);
  }
  const appData = resolvePlatformAppData();
  if (appData === undefined) {
    throw invalidInput(
      "cannot resolve the application data directory; pass appDataDir explicitly",
    );
  }
  return normalizeRoot(path.join(appData, DATA_ROOT_DIR_NAME));
}

function resolvePlatformAppData(): string | undefined {
  if (process.platform === "win32") {
    // Electron main processes pass this explicitly; plain Node gets it here.
    const appData = process.env["APPDATA"];
    return appData === undefined || appData === "" ? undefined : appData;
  }
  if (process.platform === "darwin") {
    return path.join(osHomeDir(), "Library", "Application Support");
  }
  if (process.platform === "linux") {
    const xdg = process.env["XDG_DATA_HOME"];
    return xdg !== undefined && xdg !== ""
      ? xdg
      : path.join(osHomeDir(), ".local", "share");
  }
  return undefined;
}

function osHomeDir(): string {
  return os.homedir();
}

function normalizeRoot(root: string): string {
  const resolved = path.resolve(root.trim());
  if (resolved === path.parse(resolved).root) {
    throw invalidInput("data root must not be a filesystem root directory", {
      root: resolved,
    });
  }
  return resolved;
}

/**
 * Create any missing layout directories. Never deletes or rewrites existing
 * content; safe to call on every startup.
 */
export function ensureDataLayout(root: string): DataLayout {
  const layout: DataLayout = {
    root,
    dbFile: path.join(root, "app.sqlite"),
    harnessHome: path.join(root, "harness"),
    artifacts: path.join(root, "artifacts"),
    backups: path.join(root, "backups"),
    logs: path.join(root, "logs"),
    cache: path.join(root, "cache"),
    credentials: path.join(root, "credentials"),
  };
  try {
    const stat = fs.statSync(layout.root);
    if (!stat.isDirectory()) {
      throw invalidInput("data root exists but is not a directory", {
        root: layout.root,
      });
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException | null)?.code !== "ENOENT") {
      throw storageErrorFromFsError(error, "checking the data root");
    }
    fs.mkdirSync(layout.root, { recursive: true });
  }
  for (const dir of [
    layout.harnessHome,
    layout.artifacts,
    layout.backups,
    layout.logs,
    layout.cache,
    layout.credentials,
  ]) {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (error) {
      throw storageErrorFromFsError(error, `creating ${dir}`);
    }
  }
  return layout;
}

export interface DataLocationReport {
  readonly root: string;
  readonly locations: ReadonlyArray<{
    readonly name: string;
    readonly path: string;
    readonly exists: boolean;
    readonly bytes: number | null;
  }>;
}

/** Human/IPC-facing view of the data locations (FR-09: 可查看数据位置). */
export function describeDataLocations(layout: DataLayout): DataLocationReport {
  const entries: Array<[string, string]> = [
    ["database", layout.dbFile],
    ["harnessHome", layout.harnessHome],
    ["artifacts", layout.artifacts],
    ["backups", layout.backups],
    ["logs", layout.logs],
    ["cache", layout.cache],
    ["credentials", layout.credentials],
  ];
  return {
    root: layout.root,
    locations: entries.map(([name, target]) => {
      const bytes = measureBytes(target);
      return { name, path: target, exists: bytes !== null, bytes };
    }),
  };
}

function measureBytes(target: string): number | null {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(target);
  } catch {
    return null;
  }
  if (stat.isFile()) {
    return stat.size;
  }
  return sumTreeSize(target);
}

function sumTreeSize(dir: string): number {
  let total = 0;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const child = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      total += sumTreeSize(child);
    } else if (entry.isFile()) {
      try {
        total += fs.statSync(child).size;
      } catch {
        // Unreadable entries count as zero instead of failing the report.
      }
    }
  }
  return total;
}
