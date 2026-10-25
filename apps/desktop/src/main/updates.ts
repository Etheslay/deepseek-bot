/**
 * App updates (D24): electron-updater against GitHub Releases. The release
 * pipeline (package CI + first GitHub Release) lands with the finale task;
 * until a release exists every check fails soft with a reason string, so
 * the UI can say "暂无可用更新" instead of pretending.
 */
import { autoUpdater } from "electron-updater";
import type { UpdateStatus } from "../shared/ipc-channels.js";
export { compareVersions } from "../shared/versions.js";

import { compareVersions } from "../shared/versions.js";

let downloading = false;
let readyToInstall = false;

autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;

/** Set by main/index.ts from app.getVersion() so this module stays testable. */
let appVersion = "0.0.0";
export function setAppVersion(version: string): void {
  appVersion = version;
}

export async function checkUpdates(): Promise<UpdateStatus> {
  if (downloading) {
    return {
      available: true,
      version: null,
      downloading: true,
      readyToInstall,
      error: null,
    };
  }
  try {
    const result = await autoUpdater.checkForUpdates();
    const updateInfo = result?.updateInfo;
    const version = updateInfo?.version ?? null;
    const available =
      version !== null && compareVersions(version, appVersion) > 0;
    return {
      available,
      version,
      downloading: false,
      readyToInstall,
      error: null,
    };
  } catch (error) {
    // Typical: no releases published yet, offline, 404 on latest.yml.
    return {
      available: false,
      version: null,
      downloading: false,
      readyToInstall,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function downloadAndInstallUpdate(): Promise<UpdateStatus> {
  if (downloading) {
    return {
      available: true,
      version: null,
      downloading: true,
      readyToInstall,
      error: null,
    };
  }
  downloading = true;
  try {
    await autoUpdater.downloadUpdate();
    readyToInstall = true;
    // NSIS assisted install: quit and run the updater right away.
    autoUpdater.quitAndInstall();
    return {
      available: true,
      version: null,
      downloading: false,
      readyToInstall: true,
      error: null,
    };
  } catch (error) {
    return {
      available: false,
      version: null,
      downloading: false,
      readyToInstall,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    downloading = false;
  }
}
