/**
 * Point the Host child at the fetched whisper bundle.
 *
 * Kept beside the desktop spawn path because the Electron main must not
 * import the Host package. The stamp format matches
 * packages/host/src/whisper-bundle.ts: bundle.json names two files in the
 * same directory, and a path-shaped name is ignored.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export type WhisperBundle = {
  readonly whisperBin: string;
  readonly whisperModel: string;
};

const STAMP_BYTES = 4_096;

export function readWhisperBundleDirectory(root: string): WhisperBundle | undefined {
  const stampPath = join(root, "bundle.json");
  if (!existsSync(stampPath)) return undefined;
  let size = 0;
  try {
    size = statSync(stampPath).size;
  } catch {
    return undefined;
  }
  if (size <= 0 || size > STAMP_BYTES) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(stampPath, "utf8"));
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null) return undefined;
  const record = parsed as Record<string, unknown>;
  if (!isBundleFileName(record.binary) || !isBundleFileName(record.model)) return undefined;
  const whisperBin = join(root, record.binary);
  const whisperModel = join(root, record.model);
  if (!existsSync(whisperBin) || !existsSync(whisperModel)) return undefined;
  return { whisperBin, whisperModel };
}

/**
 * Environment entries for the Host child. An explicit parent value wins so a
 * developer can still point at another local build; otherwise the fetched
 * bundle is the default. Returns nothing when no bundle is on disk.
 */
export function whisperEnvFromBundles(
  roots: readonly string[],
  current: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  for (const root of roots) {
    const found = readWhisperBundleDirectory(root);
    if (found === undefined) continue;
    const env: NodeJS.ProcessEnv = {};
    if (current.DEEPSEEK_BOT_WHISPER_BIN === undefined || current.DEEPSEEK_BOT_WHISPER_BIN.length === 0) {
      env.DEEPSEEK_BOT_WHISPER_BIN = found.whisperBin;
    }
    if (current.DEEPSEEK_BOT_WHISPER_MODEL === undefined || current.DEEPSEEK_BOT_WHISPER_MODEL.length === 0) {
      env.DEEPSEEK_BOT_WHISPER_MODEL = found.whisperModel;
    }
    return env;
  }
  return {};
}

function isBundleFileName(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 240) return false;
  if (value === "." || value === ".." || value.startsWith(".")) return false;
  return !value.includes("/") && !value.includes("\\") && !value.includes(":") && !value.includes("\0");
}
