import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { randomUUID } from "node:crypto";
import { cancelled, invalidInput, unauthorizedPath, unavailable } from "./errors.js";
import { finalizeOcrText, MAX_PNG_BYTES, exceedsImageLimits } from "./limits.js";
import { readOcrLayout } from "./ocr-layout.js";
import { isInsideDirectory } from "./paths.js";
import { readPngSize } from "./png.js";

export interface OcrEngine {
  recognize(pngBytes: Uint8Array, signal: AbortSignal): Promise<string>;
}

export async function recognizePng(options: {
  resourcesDirectory: string;
  pngPath: string;
  signal: AbortSignal;
  engine?: OcrEngine;
}): Promise<string> {
  const png = await readCapturePng(options.pngPath);
  const resources = await resolveResources(options.resourcesDirectory);
  const engine = options.engine ?? tesseractEngine(resources);
  const text = await engine.recognize(png, options.signal);
  try {
    return finalizeOcrText(text);
  } catch {
    throw invalidInput("ocr text exceeds 64 KiB", "size");
  }
}

async function readCapturePng(pngPath: string): Promise<Uint8Array> {
  if (!path.isAbsolute(pngPath) || pngPath.includes("\0") || isNetworkPath(pngPath)) {
    throw invalidInput("ocr image path is invalid", "input");
  }
  if (path.extname(pngPath).toLowerCase() !== ".png") {
    throw invalidInput("ocr image path is invalid", "input");
  }
  let info;
  try {
    info = await lstat(pngPath);
  } catch {
    throw invalidInput("ocr image is unavailable", "input");
  }
  if (info.isSymbolicLink()) throw unauthorizedPath("ocr image path is a link");
  if (!info.isFile()) throw invalidInput("ocr image path is invalid", "input");
  if (info.size > MAX_PNG_BYTES) {
    throw invalidInput("png exceeds 8 MiB", "size");
  }
  const bytes = await readFile(pngPath);
  let size;
  try {
    size = readPngSize(bytes);
  } catch {
    throw invalidInput("ocr image is not a png", "input");
  }
  if (exceedsImageLimits(size.width, size.height)) {
    throw invalidInput("image size is outside the capture limit", "size");
  }
  return new Uint8Array(bytes);
}

function isNetworkPath(value: string): boolean {
  return value.includes("://") || /^file:/i.test(value);
}

export interface OcrResources {
  root: string;
  workerPath: string;
  langPath: string;
  corePath: string;
}

export async function resolveResources(resourcesDirectory: string): Promise<OcrResources> {
  if (!path.isAbsolute(resourcesDirectory) || isNetworkPath(resourcesDirectory)) {
    throw unavailable("ocr resources are unavailable", "resources");
  }
  let root: string;
  try {
    root = await realpath(resourcesDirectory);
  } catch {
    throw unavailable("ocr resources are unavailable", "resources");
  }
  const layout = readOcrLayout();
  const required = [
    "worker.cjs",
    "manifest.json",
    ...layout.coreFiles.map((file) => path.join("core", file)),
    ...layout.langFiles.map((file) => path.join("lang", file)),
    ...layout.licenseFiles,
  ];
  for (const relative of required) {
    await assertResourceFile(root, relative);
  }
  const manifest = JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8")) as {
    pins?: unknown;
  };
  if (!samePins(manifest.pins, layout.pins)) {
    throw unavailable("ocr resources are unavailable", "resources");
  }
  return {
    root,
    workerPath: path.join(root, "worker.cjs"),
    langPath: path.join(root, "lang"),
    corePath: path.join(root, "core"),
  };
}

async function assertResourceFile(root: string, relative: string): Promise<void> {
  const candidate = path.resolve(root, relative);
  if (!isInsideDirectory(root, candidate)) {
    throw unavailable("ocr resources are unavailable", "resources");
  }
  let resolved: string;
  try {
    const info = await lstat(candidate);
    if (info.isSymbolicLink()) throw unavailable("ocr resources are unavailable", "resources");
    resolved = await realpath(candidate);
  } catch (error) {
    if (isUnavailable(error)) throw error;
    throw unavailable("ocr resources are unavailable", "resources");
  }
  if (!isInsideDirectory(root, resolved)) {
    throw unavailable("ocr resources are unavailable", "resources");
  }
}

function samePins(actual: unknown, expected: Record<string, string>): boolean {
  if (typeof actual !== "object" || actual === null) return false;
  const record = actual as Record<string, unknown>;
  return Object.entries(expected).every(([name, version]) => record[name] === version);
}

function isUnavailable(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "RUNTIME_UNAVAILABLE"
  );
}

function tesseractEngine(resources: OcrResources): OcrEngine {
  return {
    recognize(pngBytes, signal) {
      return recognizeWithBundledWorker(resources, pngBytes, signal);
    },
  };
}

async function recognizeWithBundledWorker(
  resources: OcrResources,
  pngBytes: Uint8Array,
  signal: AbortSignal,
): Promise<string> {
  if (signal.aborted) throw cancelled();
  const worker = new Worker(resources.workerPath);
  const stop = (): void => {
    void worker.terminate();
  };
  signal.addEventListener("abort", stop, { once: true });
  try {
    await workerCall(worker, signal, "load", {
      options: { lstmOnly: true, corePath: resources.corePath, logging: false },
    });
    await workerCall(worker, signal, "loadLanguage", {
      langs: ["eng", "chi_sim"],
      options: {
        langPath: resources.langPath,
        cacheMethod: "none",
        gzip: true,
        lstmOnly: true,
      },
    });
    await workerCall(worker, signal, "initialize", {
      langs: "eng+chi_sim",
      oem: 1,
      config: { user_defined_dpi: "300" },
    });
    const data = await workerCall(worker, signal, "recognize", {
      image: pngBytes,
      options: {},
      output: { text: true },
    });
    const text = isRecord(data) ? data.text : undefined;
    if (typeof text !== "string") throw unavailable("offline OCR returned no text", "ocr");
    return text;
  } catch (error) {
    if (isBackendError(error)) throw error;
    throw unavailable("offline OCR failed", "ocr");
  } finally {
    signal.removeEventListener("abort", stop);
    await worker.terminate();
  }
}

function workerCall(
  worker: Worker,
  signal: AbortSignal,
  action: string,
  payload: unknown,
): Promise<unknown> {
  const jobId = randomUUID();
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error, value?: unknown): void => {
      if (settled) return;
      settled = true;
      worker.off("message", onMessage);
      worker.off("error", onError);
      worker.off("exit", onExit);
      signal.removeEventListener("abort", onAbort);
      if (error !== undefined) reject(error);
      else resolve(value);
    };
    const onAbort = (): void => {
      void worker.terminate();
      finish(cancelled());
    };
    const onError = (): void => finish(unavailable("offline OCR worker failed", "ocr"));
    const onExit = (): void =>
      finish(signal.aborted ? cancelled() : unavailable("offline OCR worker exited", "ocr"));
    const onMessage = (packet: unknown): void => {
      if (!isRecord(packet) || packet.jobId !== jobId || packet.status === "progress") return;
      if (packet.status === "resolve") finish(undefined, packet.data);
      else finish(unavailable("offline OCR failed", "ocr"));
    };
    if (signal.aborted) {
      finish(cancelled());
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
    worker.on("message", onMessage);
    worker.on("error", onError);
    worker.on("exit", onExit);
    worker.postMessage({ workerId: "screen-ocr", jobId, action, payload });
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isBackendError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as { name?: string }).name === "ScreenBackendError"
  );
}
