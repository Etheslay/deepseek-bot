import { lstat, readFile, realpath, rm, stat } from "node:fs/promises";
import path from "node:path";
import { runWithDeadline } from "./deadline.js";
import {
  cancelled,
  invalidInput,
  unauthorizedPath,
  unavailable,
  type ScreenBackendError,
} from "./errors.js";
import {
  CAPTURE_FILE_NAME,
  CAPTURE_TIMEOUT_MS,
  MAX_PNG_BYTES,
  OCR_TIMEOUT_MS,
  exceedsImageLimits,
} from "./limits.js";
import { recognizePng, type OcrEngine } from "./ocr.js";
import { isInsideDirectory } from "./paths.js";
import { readPngSize } from "./png.js";
import {
  assertWindowIdentity,
  createPowerShellRunner,
  parseCaptureSize,
  parseWindowList,
  type HelperRunner,
  type ListedWindow,
  type WindowIdentity,
} from "./windows.js";

export interface CaptureResult {
  width: number;
  height: number;
  pngPath: string;
  byteLength: number;
}

export interface ScreenBackend {
  listWindows(signal: AbortSignal): Promise<ListedWindow[]>;
  capture(
    identity: WindowIdentity,
    outputDirectory: string,
    signal: AbortSignal,
  ): Promise<CaptureResult>;
  recognize(pngPath: string, signal: AbortSignal): Promise<string>;
  close(): void;
}

export interface ScreenBackendOptions {
  resourcesDirectory: string;
  captureTimeoutMs?: number;
  ocrTimeoutMs?: number;
  /** Test seam. Production uses the fixed PowerShell helper and bundled OCR worker. */
  helperRunner?: HelperRunner;
  ocrEngine?: OcrEngine;
}

export function createScreenBackend(options: ScreenBackendOptions): ScreenBackend {
  const resourcesDirectory = assertAbsoluteDirectory(options.resourcesDirectory);
  const captureTimeoutMs = options.captureTimeoutMs ?? CAPTURE_TIMEOUT_MS;
  const ocrTimeoutMs = options.ocrTimeoutMs ?? OCR_TIMEOUT_MS;
  assertTimeout(captureTimeoutMs);
  assertTimeout(ocrTimeoutMs);
  const helper = options.helperRunner ?? createPowerShellRunner();
  const ocrEngine = options.ocrEngine;
  const lifetime = new AbortController();
  let closed = false;

  const link = (signal: AbortSignal): AbortSignal => {
    if (closed || lifetime.signal.aborted) throw unavailable("screen backend is closed");
    if (signal.aborted) throw cancelled();
    const linked = new AbortController();
    const abort = (): void => linked.abort();
    signal.addEventListener("abort", abort, { once: true });
    lifetime.signal.addEventListener("abort", abort, { once: true });
    return linked.signal;
  };

  return {
    async listWindows(signal) {
      const linked = link(signal);
      const stdout = await runWithDeadline({
        signal: linked,
        timeoutMs: captureTimeoutMs,
        run: (child) => helper.run({ op: "list" }, child, captureTimeoutMs),
      });
      return parseWindowList(stdout);
    },

    async capture(identity, outputDirectory, signal) {
      assertWindowIdentity(identity);
      const directory = await assertCaptureDirectory(outputDirectory);
      const linked = link(signal);
      let stdout: string;
      try {
        stdout = await runWithDeadline({
          signal: linked,
          timeoutMs: captureTimeoutMs,
          run: (child) =>
            helper.run(
              {
                op: "capture",
                hwnd: identity.hwnd,
                pid: identity.pid,
                processStartTime: identity.processStartTime,
                outputDirectory: directory,
              },
              child,
              captureTimeoutMs,
            ),
        });
      } catch (error) {
        await removeCaptureFile(directory);
        throw error;
      }
      try {
        const claimed = parseCaptureSize(stdout);
        return await acceptCaptureFile(directory, claimed.width, claimed.height);
      } catch (error) {
        await removeCaptureFile(directory);
        throw error;
      }
    },

    recognize(pngPath, signal) {
      const linked = link(signal);
      return runWithDeadline({
        signal: linked,
        timeoutMs: ocrTimeoutMs,
        run: (child) =>
          recognizePng({
            resourcesDirectory,
            pngPath,
            signal: child,
            ...(ocrEngine !== undefined ? { engine: ocrEngine } : {}),
          }),
      });
    },

    close() {
      if (closed) return;
      closed = true;
      lifetime.abort();
    },
  };
}

function assertAbsoluteDirectory(resourcesDirectory: string): string {
  if (!path.isAbsolute(resourcesDirectory) || resourcesDirectory.includes("\0")) {
    throw unavailable("ocr resources are unavailable", "resources");
  }
  return resourcesDirectory;
}

function assertTimeout(timeoutMs: number): void {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw invalidInput("timeout is invalid", "input");
  }
}

async function assertCaptureDirectory(outputDirectory: string): Promise<string> {
  if (
    !path.isAbsolute(outputDirectory) ||
    outputDirectory.includes("\0") ||
    /[\r\n]/.test(outputDirectory)
  ) {
    throw invalidInput("output directory is invalid", "input");
  }
  let root: string;
  try {
    const info = await stat(outputDirectory);
    if (!info.isDirectory()) throw invalidInput("output directory is invalid", "input");
    root = await realpath(outputDirectory);
  } catch (error) {
    if (isBackend(error)) throw error;
    throw invalidInput("output directory is invalid", "input");
  }
  const target = path.join(root, CAPTURE_FILE_NAME);
  try {
    const existing = await lstat(target);
    if (existing.isSymbolicLink()) throw unauthorizedPath("capture output is a link");
  } catch (error) {
    if (isBackend(error)) throw error;
    if (!isEnoent(error)) throw invalidInput("output directory is invalid", "input");
  }
  return root;
}

async function acceptCaptureFile(
  directory: string,
  claimedWidth: number,
  claimedHeight: number,
): Promise<CaptureResult> {
  const target = path.join(directory, CAPTURE_FILE_NAME);
  const info = await lstat(target).catch(() => undefined);
  if (info === undefined || (!info.isFile() && !info.isSymbolicLink())) {
    throw unavailable("capture file is missing", "helper");
  }
  if (info.isSymbolicLink()) throw unauthorizedPath("capture output is a link");
  let resolved: string;
  try {
    resolved = await realpath(target);
  } catch {
    throw unauthorizedPath("capture output escaped the directory");
  }
  if (!isInsideDirectory(directory, resolved))
    throw unauthorizedPath("capture output escaped the directory");
  if (info.size > MAX_PNG_BYTES) throw invalidInput("png exceeds 8 MiB", "size");
  const bytes = await readFile(target);
  let actual;
  try {
    actual = readPngSize(bytes);
  } catch {
    throw invalidInput("capture file is not a png", "input");
  }
  if (
    actual.width !== claimedWidth ||
    actual.height !== claimedHeight ||
    exceedsImageLimits(actual.width, actual.height)
  ) {
    throw invalidInput("window size is outside the capture limit", "size");
  }
  return {
    width: actual.width,
    height: actual.height,
    pngPath: resolved,
    byteLength: bytes.length,
  };
}

async function removeCaptureFile(directory: string): Promise<void> {
  const target = path.join(directory, CAPTURE_FILE_NAME);
  try {
    const info = await lstat(target);
    if (info.isSymbolicLink() || info.isFile()) await rm(target);
  } catch {
    // The helper did not leave a file.
  }
}

function isBackend(error: unknown): error is ScreenBackendError {
  return error instanceof Error && error.name === "ScreenBackendError";
}

function isEnoent(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "ENOENT"
  );
}
