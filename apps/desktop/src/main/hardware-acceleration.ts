/**
 * Hardware-acceleration shell preference (D24 leftover).
 *
 * Chromium's toggle only counts before `app.ready`, so the preference lives
 * in its own file under Electron's userData (shell-level prefs, not the
 * data root that storage owns) and is applied synchronously at module load —
 * before the `whenReady` block in index.ts. The renderer reads the current
 * preference and flips it through the app:hardwareAcceleration channel;
 * every change needs an app restart to apply.
 */
import fs from "node:fs";
import { join } from "node:path";
import { app } from "electron";
import { type HardwareAccelerationStatus } from "../shared/ipc-channels.js";

const PREFERENCE_FILE = "hardware-acceleration.json";

function preferenceFile(): string {
  return join(app.getPath("userData"), PREFERENCE_FILE);
}

/** Read the stored preference; anything unreadable counts as enabled (default). */
export function readHardwareAccelerationEnabled(): boolean {
  try {
    const parsed = JSON.parse(fs.readFileSync(preferenceFile(), { encoding: "utf8" })) as {
      enabled?: unknown;
    };
    return parsed.enabled !== false;
  } catch {
    return true;
  }
}

/** Call once at module load, before app.ready — Chromium ignores it later. */
export function applyHardwareAccelerationPreference(): void {
  if (!readHardwareAccelerationEnabled()) {
    app.disableHardwareAcceleration();
  }
}

export function getHardwareAcceleration(): HardwareAccelerationStatus {
  return { enabled: readHardwareAccelerationEnabled(), restartRequired: false };
}

export function setHardwareAcceleration(enabled: boolean): HardwareAccelerationStatus {
  const current = readHardwareAccelerationEnabled();
  if (enabled !== current) {
    fs.writeFileSync(preferenceFile(), `${JSON.stringify({ enabled })}\n`, {
      encoding: "utf8",
    });
    return { enabled, restartRequired: true };
  }
  return { enabled: current, restartRequired: false };
}
