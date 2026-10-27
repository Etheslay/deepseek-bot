/**
 * Host screen service (D21 §3). Window tokens and the selected target live
 * only for this process generation. Captures wait for one D16 approval, then
 * re-check the target and the ticket before the backend runs. Bytes stay
 * under screen-outputs and never enter the model result or the audit record.
 */
import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { PNG } from "pngjs";
import { encode } from "jpeg-js";
import { ScreenResultSchema, type ScreenMode, type ScreenResult } from "@deepseek-bot/contracts";
import { ScreenBackendError, type ScreenBackend } from "@deepseek-bot/exec-daemon";
import { getBot, listPermissionPolicies, type OpenedDatabase } from "@deepseek-bot/storage";
import {
  ToolRejectionError,
  type GrantCheckResult,
  type ToolCallOptions,
  type ToolCaller,
  type ToolContext,
} from "@deepseek-bot/agent-tools";
import type { AgentPermissionService } from "./agent-permissions.js";

const MAX_RESULTS = 50;
const MAX_JPEG_BYTES = 256 * 1024;
const MAX_PNG_BYTES = 8 * 1024 * 1024;
const MAX_OCR_BYTES = 64 * 1024;
const MAX_OCR_CHARS = 65_536;
const MAX_WINDOWS = 200;
const MAX_EDGE = 8192;
const MAX_PIXELS = 16_000_000;

interface Snapshot {
  readonly selectionId: string;
  readonly hwnd: string;
  readonly pid: number;
  readonly processStartTime: string;
  readonly title: string;
  readonly generation: number;
}

interface CatalogEntry {
  readonly hwnd: string;
  readonly pid: number;
  readonly processStartTime: string;
  title: string;
}

interface Operation {
  readonly controller: AbortController;
  detach(): void;
}

export interface ScreenService {
  status(botId: string): {
    supported: boolean;
    enabled: boolean;
    target: { id: string; title: string } | null;
    busy: boolean;
  };
  listWindows(signal: AbortSignal): Promise<{ windows: Array<{ id: string; title: string }> }>;
  select(
    botId: string,
    id: string | null,
  ): {
    supported: boolean;
    enabled: boolean;
    target: { id: string; title: string } | null;
    busy: boolean;
  };
  request(botId: string, mode: ScreenMode): Promise<ScreenResult>;
  cancel(botId: string): { cancelled: boolean };
  /** Abort this bot's capture and drop its in-memory target. */
  release(botId: string): void;
  listResults(botId: string): Promise<{ results: ScreenResult[] }>;
  readResult(
    botId: string,
    id: string,
  ): Promise<{ result: ScreenResult; imageBase64: string; text: string | null }>;
  deleteResult(botId: string, id: string): Promise<{ deleted: true }>;
  visible(botId: string | undefined): boolean;
  authorize(
    caller: ToolCaller,
    mode: ScreenMode,
    options: ToolCallOptions,
  ): Promise<GrantCheckResult>;
  capture(caller: ToolCaller, mode: ScreenMode, context: ToolContext): Promise<ScreenResult>;
  invalidate(): void;
  close(): void;
}

export function unavailableScreenBackend(): ScreenBackend {
  const fail = (): Promise<never> =>
    Promise.reject(
      new ScreenBackendError({
        code: "RUNTIME_UNAVAILABLE",
        message: "screen capture is not available",
      }),
    );
  return {
    listWindows: fail,
    capture: fail,
    recognize: fail,
    close(): void {},
  };
}

export function createScreenService(options: {
  readonly root: string;
  readonly db: OpenedDatabase;
  readonly permissions: AgentPermissionService;
  readonly now: () => Date;
  readonly backend: ScreenBackend;
  readonly supported: boolean;
}): ScreenService {
  const root = path.resolve(options.root);
  const catalog = new Map<string, CatalogEntry>();
  const selected = new Map<string, Snapshot>();
  const ops = new Map<string, Operation>();
  const lifetime = new AbortController();
  let busy = false;
  let closed = false;

  function reject(code: ToolRejectionError["code"], message: string): never {
    throw new ToolRejectionError(code, message);
  }

  function enabled(): boolean {
    return (
      listPermissionPolicies(options.db).find((policy) => policy.capability === "screen.capture")
        ?.mode === "ask"
    );
  }

  function liveBot(botId: string): void {
    const bot = getBot(options.db, botId);
    if (bot === undefined) reject("INVALID_INPUT", "screen bot was not found");
    if (bot.archivedAt !== null) reject("INVALID_INPUT", "archived bots cannot capture the screen");
  }

  function finish(botId: string, controller: AbortController): void {
    const operation = ops.get(botId);
    if (operation?.controller !== controller) return;
    operation.detach();
    ops.delete(botId);
  }

  function begin(botId: string, parent: AbortSignal | undefined): AbortController {
    if (closed) reject("RUNTIME_UNAVAILABLE", "screen host is closed");
    if (ops.has(botId)) reject("RATE_LIMITED", "screen capture is already in progress");
    const controller = new AbortController();
    const abort = (): void => controller.abort();
    parent?.addEventListener("abort", abort, { once: true });
    lifetime.signal.addEventListener("abort", abort, { once: true });
    ops.set(botId, {
      controller,
      detach: () => {
        parent?.removeEventListener("abort", abort);
        lifetime.signal.removeEventListener("abort", abort);
      },
    });
    if (parent?.aborted || lifetime.signal.aborted) controller.abort();
    return controller;
  }

  function assertSnapshot(botId: string, snapshot: Snapshot): void {
    const current = selected.get(botId);
    if (
      current === undefined ||
      current.generation !== snapshot.generation ||
      snapshot.generation !== options.permissions.generation ||
      current.selectionId !== snapshot.selectionId ||
      current.hwnd !== snapshot.hwnd ||
      current.pid !== snapshot.pid ||
      current.processStartTime !== snapshot.processStartTime ||
      current.title !== snapshot.title
    ) {
      reject("UNAUTHORIZED_PATH", "screen target changed");
    }
  }

  async function resultsOf(botId: string): Promise<ScreenResult[]> {
    const file = path.join(root, botId, "manifest.json");
    let bytes: Buffer;
    try {
      const info = await lstat(file);
      if (info.isSymbolicLink()) reject("UNAUTHORIZED_PATH", "screen result manifest is a link");
      bytes = await readFile(file);
    } catch (error) {
      if (isMissing(error)) return [];
      if (error instanceof ToolRejectionError) throw error;
      reject("RUNTIME_UNAVAILABLE", "screen results are unavailable");
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(bytes.toString("utf8")) as unknown;
    } catch {
      reject("RUNTIME_UNAVAILABLE", "screen results are unavailable");
    }
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !Array.isArray((parsed as { results?: unknown }).results)
    ) {
      reject("RUNTIME_UNAVAILABLE", "screen results are unavailable");
    }
    return (parsed as { results: unknown[] }).results.map((entry) => {
      const result = ScreenResultSchema.safeParse(entry);
      if (!result.success) reject("RUNTIME_UNAVAILABLE", "screen results are unavailable");
      return result.data;
    });
  }

  async function writeManifest(botId: string, results: readonly ScreenResult[]): Promise<void> {
    const directory = path.join(root, botId);
    await mkdir(directory, { recursive: true });
    const next = path.join(directory, `.manifest-${randomUUID()}.json`);
    const dest = path.join(directory, "manifest.json");
    await writeFile(next, JSON.stringify({ results }), "utf8");
    await replaceFile(next, dest);
  }

  function statusOf(botId: string): {
    supported: boolean;
    enabled: boolean;
    target: { id: string; title: string } | null;
    busy: boolean;
  } {
    liveBot(botId);
    const target = selected.get(botId);
    return {
      supported: options.supported,
      enabled: enabled(),
      target:
        target === undefined || target.generation !== options.permissions.generation
          ? null
          : { id: target.selectionId, title: target.title },
      busy: busy || ops.has(botId),
    };
  }

  async function authorize(
    caller: ToolCaller,
    mode: ScreenMode,
    callOptions: ToolCallOptions,
  ): Promise<GrantCheckResult> {
    if (closed) reject("RUNTIME_UNAVAILABLE", "screen host is closed");
    if (caller.botId === undefined) {
      reject("UNAUTHORIZED_PATH", "screen capture requires a trusted bot");
    }
    const botId = caller.botId;
    liveBot(botId);
    if (!options.supported) reject("RUNTIME_UNAVAILABLE", "screen capture is not available");
    if (!enabled()) {
      return options.permissions.check("screen_capture", caller, { mode }, callOptions);
    }
    const snapshot = selected.get(botId);
    if (snapshot === undefined || snapshot.generation !== options.permissions.generation) {
      reject("INVALID_INPUT", "screen target is not selected");
    }
    if ((await resultsOf(botId)).length >= MAX_RESULTS) {
      reject("INVALID_INPUT", "delete a screen result before capturing another");
    }
    const controller = begin(botId, callOptions.signal);
    try {
      const authorization = await options.permissions.check(
        "screen_capture",
        caller,
        {
          mode,
          selectionId: snapshot.selectionId,
          windowTitle: snapshot.title,
        },
        { ...callOptions, signal: controller.signal },
      );
      if (!authorization.allowed) {
        finish(botId, controller);
        return authorization;
      }
      return {
        ...authorization,
        revalidate() {
          try {
            authorization.revalidate?.();
            assertSnapshot(botId, snapshot);
            if (controller.signal.aborted) reject("CANCELLED", "screen capture was cancelled");
          } catch (error) {
            finish(botId, controller);
            throw error;
          }
        },
      };
    } catch (error) {
      finish(botId, controller);
      throw error;
    }
  }

  async function capture(
    caller: ToolCaller,
    mode: ScreenMode,
    context: ToolContext,
  ): Promise<ScreenResult> {
    if (caller.botId === undefined) {
      reject("UNAUTHORIZED_PATH", "screen capture requires a trusted bot");
    }
    const botId = caller.botId;
    const operation = ops.get(botId);
    if (operation === undefined) reject("CANCELLED", "screen capture was cancelled");
    const controller = operation.controller;
    let acquired = false;
    const resultId = randomUUID();
    const temp = path.join(root, botId, `.tmp-${resultId}`);
    try {
      if (controller.signal.aborted) reject("CANCELLED", "screen capture was cancelled");
      if (busy) reject("RATE_LIMITED", "screen capture is busy");
      busy = true;
      acquired = true;
      context.revalidateAuthorization?.();
      const snapshot = selected.get(botId);
      if (snapshot === undefined) reject("UNAUTHORIZED_PATH", "screen target changed");
      if ((await resultsOf(botId)).length >= MAX_RESULTS) {
        reject("INVALID_INPUT", "delete a screen result before capturing another");
      }
      await mkdir(temp, { recursive: true });
      context.revalidateAuthorization?.();
      const captured = await options.backend.capture(
        {
          hwnd: snapshot.hwnd,
          pid: snapshot.pid,
          processStartTime: snapshot.processStartTime,
        },
        temp,
        controller.signal,
      );
      if (
        !Number.isInteger(captured.width) ||
        !Number.isInteger(captured.height) ||
        captured.width < 1 ||
        captured.height < 1 ||
        captured.width > MAX_EDGE ||
        captured.height > MAX_EDGE ||
        captured.width * captured.height > MAX_PIXELS
      ) {
        reject("INVALID_INPUT", "screen capture exceeds the image limit");
      }
      const png = await readInside(temp, "capture.png", MAX_PNG_BYTES);
      if (png.length !== captured.byteLength) {
        reject("INVALID_INPUT", "screen capture did not match the checked file");
      }
      const preview = previewJpeg(png);
      await writeFile(path.join(temp, "preview.jpg"), preview);
      if (mode === "ocr") {
        context.revalidateAuthorization?.();
        const text = await options.backend.recognize(
          path.join(temp, "capture.png"),
          controller.signal,
        );
        if (Buffer.byteLength(text) > MAX_OCR_BYTES || text.length > MAX_OCR_CHARS) {
          reject("INVALID_INPUT", "screen text exceeds the limit");
        }
        await writeFile(path.join(temp, "ocr.txt"), text, "utf8");
      }
      context.revalidateAuthorization?.();
      const result = ScreenResultSchema.parse({
        id: resultId,
        mode,
        at: options.now().toISOString(),
        width: captured.width,
        height: captured.height,
        hasOcr: mode === "ocr",
      });
      const published = path.join(root, botId, resultId);
      await replaceFile(temp, published);
      try {
        const prior = await resultsOf(botId);
        await writeManifest(botId, [result, ...prior].slice(0, MAX_RESULTS));
      } catch (error) {
        await rm(published, { recursive: true, force: true }).catch(() => undefined);
        throw error;
      }
      return result;
    } catch (error) {
      await rm(temp, { recursive: true, force: true }).catch(() => undefined);
      throw error instanceof ToolRejectionError ? error : backendError(error);
    } finally {
      if (acquired) busy = false;
      finish(botId, controller);
    }
  }

  const service: ScreenService = {
    status: statusOf,

    async listWindows(signal) {
      if (!options.supported || closed) {
        reject("RUNTIME_UNAVAILABLE", "screen capture is not available");
      }
      if (signal.aborted || lifetime.signal.aborted) {
        reject("CANCELLED", "screen capture was cancelled");
      }
      const linked = AbortSignal.any([signal, lifetime.signal]);
      let listed;
      try {
        listed = await options.backend.listWindows(linked);
      } catch (error) {
        throw backendError(error);
      }
      const windows: Array<{ id: string; title: string }> = [];
      for (const row of listed) {
        if (windows.length >= MAX_WINDOWS) break;
        if (row.title.length < 1 || row.title.length > 512) continue;
        const id = tokenFor(catalog, row);
        const entry = catalog.get(id);
        if (entry !== undefined) entry.title = row.title;
        if (windows.some((item) => item.id === id)) continue;
        windows.push({ id, title: row.title });
      }
      for (const [botId, snapshot] of selected) {
        const entry = catalog.get(snapshot.selectionId);
        if (entry !== undefined && entry.title !== snapshot.title) {
          ops.get(botId)?.controller.abort();
        }
      }
      return { windows };
    },

    select(botId, id) {
      liveBot(botId);
      if (!options.supported || closed) {
        reject("RUNTIME_UNAVAILABLE", "screen capture is not available");
      }
      ops.get(botId)?.controller.abort();
      if (id === null) {
        selected.delete(botId);
        return statusOf(botId);
      }
      const entry = catalog.get(id);
      if (entry === undefined) reject("INVALID_INPUT", "screen window is not in the current list");
      selected.set(botId, {
        selectionId: id,
        hwnd: entry.hwnd,
        pid: entry.pid,
        processStartTime: entry.processStartTime,
        title: entry.title,
        generation: options.permissions.generation,
      });
      return statusOf(botId);
    },

    async request(botId, mode) {
      const caller: ToolCaller = { id: `ui:${botId}`, botId };
      const grant = await authorize(caller, mode, {});
      if (!grant.allowed) {
        reject(
          grant.code ?? "UNAUTHORIZED_PATH",
          grant.reason ?? "screen capture was not approved",
        );
      }
      grant.revalidate?.();
      return capture(caller, mode, {
        caller,
        ...(grant.revalidate !== undefined ? { revalidateAuthorization: grant.revalidate } : {}),
      });
    },

    cancel(botId) {
      const operation = ops.get(botId);
      if (operation === undefined) return { cancelled: false };
      operation.controller.abort();
      return { cancelled: true };
    },

    release(botId) {
      selected.delete(botId);
      ops.get(botId)?.controller.abort();
    },

    async listResults(botId) {
      liveBot(botId);
      return { results: await resultsOf(botId) };
    },

    async readResult(botId, id) {
      liveBot(botId);
      const result = (await resultsOf(botId)).find((item) => item.id === id);
      if (result === undefined) reject("INVALID_INPUT", "screen result was not found");
      const directory = await resultDirectory(root, botId, id);
      const image = await readInside(directory, "preview.jpg", MAX_JPEG_BYTES);
      const imageBase64 = image.toString("base64");
      if (imageBase64.length > 360_000) {
        reject("INVALID_INPUT", "screen preview exceeds the read limit");
      }
      let text: string | null = null;
      if (result.hasOcr) {
        text = (await readInside(directory, "ocr.txt", MAX_OCR_BYTES)).toString("utf8");
        if (text.length > MAX_OCR_CHARS)
          reject("INVALID_INPUT", "screen text exceeds the read limit");
      }
      return { result, imageBase64, text };
    },

    async deleteResult(botId, id) {
      liveBot(botId);
      const results = await resultsOf(botId);
      if (!results.some((item) => item.id === id)) {
        reject("INVALID_INPUT", "screen result was not found");
      }
      const directory = await resultDirectory(root, botId, id);
      await writeManifest(
        botId,
        results.filter((item) => item.id !== id),
      );
      await rm(directory, { recursive: true, force: true });
      return { deleted: true };
    },

    visible(botId) {
      if (!options.supported || closed || botId === undefined) return false;
      const bot = getBot(options.db, botId);
      const target = selected.get(botId);
      return (
        bot !== undefined &&
        bot.archivedAt === null &&
        enabled() &&
        target !== undefined &&
        target.generation === options.permissions.generation
      );
    },

    authorize,
    capture,

    invalidate() {
      for (const operation of ops.values()) operation.controller.abort();
    },

    close() {
      if (closed) return;
      closed = true;
      lifetime.abort();
      service.invalidate();
      options.backend.close();
    },
  };
  return service;
}

function tokenFor(
  catalog: Map<string, CatalogEntry>,
  row: { hwnd: string; pid: number; processStartTime: string; title: string },
): string {
  for (const [id, entry] of catalog) {
    if (
      entry.hwnd === row.hwnd &&
      entry.pid === row.pid &&
      entry.processStartTime === row.processStartTime
    ) {
      return id;
    }
  }
  const id = randomUUID();
  catalog.set(id, {
    hwnd: row.hwnd,
    pid: row.pid,
    processStartTime: row.processStartTime,
    title: row.title,
  });
  return id;
}

function previewJpeg(png: Buffer): Buffer {
  let image: PNG;
  try {
    image = PNG.sync.read(png);
  } catch {
    throw new ToolRejectionError("INVALID_INPUT", "screen capture is not a png");
  }
  let width = image.width;
  let height = image.height;
  let data: Buffer = image.data;
  let quality = 80;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const jpeg = Buffer.from(encode({ data, width, height }, quality).data);
    if (jpeg.length <= MAX_JPEG_BYTES) return jpeg;
    if (quality > 25) {
      quality -= 15;
      continue;
    }
    const nextWidth = Math.max(1, Math.floor(width / 2));
    const nextHeight = Math.max(1, Math.floor(height / 2));
    if (nextWidth === width && nextHeight === height) break;
    data = downsample(data, width, height, nextWidth, nextHeight);
    width = nextWidth;
    height = nextHeight;
    quality = 60;
  }
  throw new ToolRejectionError("INVALID_INPUT", "screen preview exceeds 256 KiB");
}

function downsample(
  data: Buffer,
  width: number,
  height: number,
  nextWidth: number,
  nextHeight: number,
): Buffer {
  const out = Buffer.alloc(nextWidth * nextHeight * 4);
  for (let y = 0; y < nextHeight; y += 1) {
    const sy = Math.min(height - 1, Math.floor((y * height) / nextHeight));
    for (let x = 0; x < nextWidth; x += 1) {
      const sx = Math.min(width - 1, Math.floor((x * width) / nextWidth));
      const source = (sy * width + sx) * 4;
      const target = (y * nextWidth + x) * 4;
      out[target] = data[source] ?? 0;
      out[target + 1] = data[source + 1] ?? 0;
      out[target + 2] = data[source + 2] ?? 0;
      out[target + 3] = data[source + 3] ?? 0;
    }
  }
  return out;
}

async function resultDirectory(root: string, botId: string, id: string): Promise<string> {
  const directory = path.join(root, botId, id);
  let info;
  try {
    info = await lstat(directory);
  } catch {
    throw new ToolRejectionError("RUNTIME_UNAVAILABLE", "screen result is unavailable");
  }
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new ToolRejectionError("UNAUTHORIZED_PATH", "screen result path is not a directory");
  }
  const resolved = await realpath(directory);
  const botRoot = await realpath(path.join(root, botId));
  if (!isInside(botRoot, resolved)) {
    throw new ToolRejectionError("UNAUTHORIZED_PATH", "screen result escaped its directory");
  }
  return resolved;
}

async function readInside(directory: string, name: string, maxBytes: number): Promise<Buffer> {
  const target = path.join(directory, name);
  let info;
  try {
    info = await lstat(target);
  } catch {
    throw new ToolRejectionError("RUNTIME_UNAVAILABLE", "screen result is unavailable");
  }
  if (info.isSymbolicLink() || !info.isFile()) {
    throw new ToolRejectionError("UNAUTHORIZED_PATH", "screen result file is a link");
  }
  if (info.size > maxBytes) {
    throw new ToolRejectionError("INVALID_INPUT", "screen result exceeds the size limit");
  }
  // realpath both sides. A Windows 8.3 temp alias (RUNNER~1) and the long
  // path are different strings until both have been resolved.
  const resolvedDirectory = await realpath(directory);
  const resolved = await realpath(target);
  if (!isInside(resolvedDirectory, resolved)) {
    throw new ToolRejectionError("UNAUTHORIZED_PATH", "screen result escaped its directory");
  }
  return readFile(resolved);
}

async function replaceFile(source: string, dest: string): Promise<void> {
  try {
    await rename(source, dest);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EEXIST" && code !== "EPERM") throw error;
    await rm(dest, { recursive: true, force: true });
    await rename(source, dest);
  }
}

function isInside(root: string, candidate: string): boolean {
  const left = process.platform === "win32" ? root.toLowerCase() : root;
  const right = process.platform === "win32" ? candidate.toLowerCase() : candidate;
  const relative = path.relative(left, right);
  return (
    relative === "" ||
    (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

function backendError(error: unknown): ToolRejectionError {
  if (error instanceof ToolRejectionError) return error;
  if (error instanceof ScreenBackendError) {
    const message = {
      INVALID_INPUT: "screen capture was rejected",
      UNAUTHORIZED_PATH: "screen capture path was rejected",
      RUNTIME_UNAVAILABLE: "screen capture is not available",
      TOOL_TIMEOUT: "screen capture timed out",
      CANCELLED: "screen capture was cancelled",
    }[error.code];
    return new ToolRejectionError(error.code, message);
  }
  return new ToolRejectionError("RUNTIME_UNAVAILABLE", "screen capture failed");
}
