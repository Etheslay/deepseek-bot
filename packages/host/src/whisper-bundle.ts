/**
 * Locate the whisper.cpp CLI and ggml model fetched by
 * apps/desktop/scripts/fetch-whisper.mts.
 *
 * The desktop dev/pack script writes resources/whisper/dist/bundle.json.
 * Packaging copies that directory to resources/whisper next to the Host.
 * Transcription reads only these local files.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type WhisperBundle = {
  readonly whisperBin: string;
  readonly whisperModel: string;
};

const STAMP_BYTES = 4_096;

/** Directories the Host checks, in order, for one fetched whisper bundle. */
export function whisperBundleCandidates(moduleUrl: string): string[] {
  const here = dirname(fileURLToPath(moduleUrl));
  return [
    // Packaged layout: resources/host/main.js beside resources/whisper/.
    join(here, "..", "whisper"),
    // Source checkout: packages/host/src or packages/host/dist.
    join(here, "..", "..", "..", "apps", "desktop", "resources", "whisper", "dist"),
  ];
}

export function resolveWhisperBundle(roots: readonly string[]): Partial<WhisperBundle> {
  for (const root of roots) {
    const found = readWhisperBundleDirectory(root);
    if (found !== undefined) return found;
  }
  return {};
}

/**
 * Read one bundle directory. A missing, huge, or path-shaped stamp yields
 * undefined so voice.status stays "not configured" instead of throwing.
 */
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

function isBundleFileName(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 240) return false;
  if (value === "." || value === ".." || value.startsWith(".")) return false;
  return !value.includes("/") && !value.includes("\\") && !value.includes(":") && !value.includes("\0");
}

export function bundledWhisper(moduleUrl: string): Partial<WhisperBundle> {
  return resolveWhisperBundle(whisperBundleCandidates(moduleUrl));
}
