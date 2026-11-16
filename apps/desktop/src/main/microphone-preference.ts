/**
 * Microphone shell preference.
 *
 * Hold-to-talk asks Chromium for audio. This file is the on/off switch in
 * Settings → Computer. It lives under Electron userData, next to the
 * hardware-acceleration preference, and is read on every permission check so
 * a flip applies to the next recording without a restart. Missing or
 * unreadable contents stay on: that is how the shell already behaved.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const PREFERENCE_FILE = "microphone.json";

let directory: string | null = null;
let cached: boolean | null = null;

/** Point the preference at a directory. Clears the in-memory copy. */
export function configureMicrophonePreference(dir: string): void {
  directory = dir;
  cached = null;
}

function preferenceFile(): string | null {
  if (directory === null) {
    return null;
  }
  return join(directory, PREFERENCE_FILE);
}

/** Whether the composer may open the microphone. Defaults to on. */
export function readMicrophoneEnabled(): boolean {
  if (cached !== null) {
    return cached;
  }
  const file = preferenceFile();
  if (file === null) {
    cached = true;
    return true;
  }
  try {
    const parsed = JSON.parse(readFileSync(file, { encoding: "utf8" })) as { enabled?: unknown };
    cached = parsed.enabled !== false;
  } catch {
    cached = true;
  }
  return cached;
}

/** Persist the switch. The next permission check sees this value. */
export function setMicrophoneEnabled(enabled: boolean): { enabled: boolean } {
  cached = enabled;
  const file = preferenceFile();
  if (file !== null) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify({ enabled })}\n`, { encoding: "utf8" });
  }
  return { enabled };
}
