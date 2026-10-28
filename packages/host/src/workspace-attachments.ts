/**
 * Chat attachments land in the bot workspace only after the tool gateway
 * accepts `import_attachment` (D26). Bytes stay in memory until that call
 * runs; the approval preview never receives them.
 */
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  ATTACHMENT_CHUNK_RAW_BYTES,
  MAX_CHAT_ATTACHMENT_BYTES,
  RelativeArtifactPathSchema,
  artifactMediaTypeForPath,
} from "@deepseek-bot/contracts";
import { ToolRejectionError, type ToolCaller } from "@deepseek-bot/agent-tools";
import type { ImportedAttachment, WorkspaceRead } from "@deepseek-bot/agent-tools";
import { EngineError } from "@deepseek-bot/runtime";
import { getBot, getWorkspace, type OpenedDatabase } from "@deepseek-bot/storage";
import { resolveInsideWorkspace } from "./artifacts.js";

const READ_TEXT_CHARS = 32_000;
const UPLOAD_TTL_MS = 10 * 60_000;
const TEXT_EXTENSIONS = new Set([
  ".md",
  ".markdown",
  ".txt",
  ".json",
  ".csv",
  ".html",
  ".htm",
  ".ts",
  ".tsx",
  ".js",
  ".py",
  ".yaml",
  ".yml",
  ".xml",
  ".css",
]);

export interface AttachmentChunk {
  readonly botId: string;
  readonly uploadId: string;
  readonly name: string;
  readonly mediaType: string;
  readonly size: number;
  readonly checksum: string;
  readonly index: number;
  readonly count: number;
  readonly data: string;
}

export interface AttachmentIngress {
  accept(chunk: AttachmentChunk): Promise<
    | { status: "staged"; received: number }
    | {
        status: "imported";
        relativePath: string;
        mediaType: string;
        size: number;
        checksum: string;
      }
  >;
}

interface StagedUpload {
  readonly botId: string;
  readonly name: string;
  readonly mediaType: string;
  readonly size: number;
  readonly checksum: string;
  readonly count: number;
  readonly chunks: Map<number, Buffer>;
  expiresAt: number;
}

export class AttachmentByteStore {
  private readonly pending = new Map<string, { botId: string; bytes: Buffer }>();

  put(uploadId: string, botId: string, bytes: Buffer): void {
    this.pending.set(uploadId, { botId, bytes });
  }

  take(uploadId: string, botId: string): Buffer {
    const row = this.pending.get(uploadId);
    if (row === undefined || row.botId !== botId) {
      throw new ToolRejectionError("INVALID_INPUT", "attachment bytes are not staged for this bot");
    }
    return row.bytes;
  }

  drop(uploadId: string): void {
    this.pending.delete(uploadId);
  }
}

function reject(code: ToolRejectionError["code"], message: string): never {
  throw new ToolRejectionError(code, message);
}

function workspaceRoot(db: OpenedDatabase, botId: string): string {
  const bot = getBot(db, botId);
  if (bot === undefined || bot.archivedAt !== null) {
    reject("UNAUTHORIZED_PATH", "attachment bot is not available");
  }
  const workspace = getWorkspace(db, bot.workspaceId);
  if (workspace === undefined) {
    reject("INVALID_INPUT", "attachment workspace is missing");
  }
  return workspace.canonicalPath;
}

function mapFsError(error: unknown): never {
  if (error instanceof ToolRejectionError) throw error;
  if (error instanceof EngineError) {
    const code = error.code === "UNAUTHORIZED_PATH" ? "UNAUTHORIZED_PATH" : "INVALID_INPUT";
    reject(code, "attachment path is not inside the bot workspace");
  }
  throw error;
}

export function safeAttachmentName(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? "";
  const cleaned = base
    .replace(/[^A-Za-z0-9._-]/g, "_")
    .replace(/^\.+/, "")
    .slice(0, 80);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(cleaned)) {
    reject("INVALID_INPUT", "attachment name is not usable");
  }
  return cleaned;
}

function hidden(relativePath: string): boolean {
  return relativePath.split(/[\\/]/).some((segment) => segment.startsWith("."));
}

export function createWorkspaceAttachmentFiles(db: OpenedDatabase) {
  const write = (botId: string, name: string, bytes: Buffer): ImportedAttachment => {
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_CHAT_ATTACHMENT_BYTES) {
      reject("INVALID_INPUT", "attachment size is outside the limit");
    }
    const root = workspaceRoot(db, botId);
    const safe = safeAttachmentName(name);
    const dot = safe.lastIndexOf(".");
    const stem = dot > 0 ? safe.slice(0, dot) : safe;
    const ext = dot > 0 ? safe.slice(dot) : "";
    let relativePath = "";
    for (let n = 0; n < 100; n += 1) {
      const candidate = n === 0 ? safe : `${stem}-${n + 1}${ext}`;
      const relative = `attachments/${candidate}`;
      if (!RelativeArtifactPathSchema.safeParse(relative).success || hidden(relative)) {
        reject("INVALID_INPUT", "attachment path is not usable");
      }
      let exists = false;
      try {
        exists = resolveInsideWorkspace(root, relative).exists;
      } catch (error) {
        mapFsError(error);
      }
      if (!exists) {
        relativePath = relative;
        break;
      }
    }
    if (relativePath.length === 0) reject("INVALID_INPUT", "attachment name is exhausted");
    let absolute = "";
    try {
      absolute = resolveInsideWorkspace(root, relativePath).absolute;
    } catch (error) {
      mapFsError(error);
    }
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    const temporary = `${absolute}.d26-tmp-${randomUUID()}`;
    fs.writeFileSync(temporary, bytes);
    try {
      fs.renameSync(temporary, absolute);
    } catch (error) {
      try {
        fs.unlinkSync(temporary);
      } catch {
        // The failed temporary file is best-effort cleanup.
      }
      throw error;
    }
    const written = fs.readFileSync(absolute);
    return {
      relativePath,
      mediaType: artifactMediaTypeForPath(relativePath),
      size: written.byteLength,
      checksum: createHash("sha256").update(written).digest("hex"),
    };
  };

  const read = (botId: string, relativePath: string): WorkspaceRead => {
    if (!RelativeArtifactPathSchema.safeParse(relativePath).success || hidden(relativePath)) {
      reject("UNAUTHORIZED_PATH", "attachment path is not inside the bot workspace");
    }
    const root = workspaceRoot(db, botId);
    let absolute = "";
    let exists = false;
    try {
      const resolved = resolveInsideWorkspace(root, relativePath);
      absolute = resolved.absolute;
      exists = resolved.exists;
    } catch (error) {
      mapFsError(error);
    }
    if (!exists) reject("INVALID_INPUT", "workspace file does not exist");
    const bytes = fs.readFileSync(absolute);
    const mediaType = artifactMediaTypeForPath(relativePath);
    const extension = path.extname(relativePath).toLowerCase();
    const textLike =
      (mediaType.startsWith("text/") ||
        mediaType === "application/json" ||
        TEXT_EXTENSIONS.has(extension)) &&
      !bytes.includes(0);
    if (textLike) {
      const content = bytes.toString("utf8");
      const truncated = content.length > READ_TEXT_CHARS;
      return {
        kind: "text",
        relativePath,
        mediaType,
        content: truncated ? content.slice(0, READ_TEXT_CHARS) : content,
        truncated,
      };
    }
    if (mediaType.startsWith("image/") && mediaType !== "image/svg+xml") {
      return { kind: "image", relativePath, mediaType, size: bytes.byteLength };
    }
    return { kind: "binary", relativePath, mediaType, size: bytes.byteLength };
  };

  return { write, read };
}

function decodeChunk(data: string): Buffer {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(data) || data.length % 4 !== 0) {
    throw new EngineError({
      code: "INVALID_INPUT",
      message: "attachment chunk is not base64",
      retryable: false,
    });
  }
  const bytes = Buffer.from(data, "base64");
  if (bytes.toString("base64") !== data) {
    throw new EngineError({
      code: "INVALID_INPUT",
      message: "attachment chunk is not canonical base64",
      retryable: false,
    });
  }
  if (bytes.byteLength === 0 || bytes.byteLength > ATTACHMENT_CHUNK_RAW_BYTES) {
    throw new EngineError({
      code: "INVALID_INPUT",
      message: "attachment chunk size is outside the limit",
      retryable: false,
    });
  }
  return bytes;
}

export function createAttachmentIngress(options: {
  readonly db: OpenedDatabase;
  readonly bytes: AttachmentByteStore;
  readonly files: ReturnType<typeof createWorkspaceAttachmentFiles>;
  readonly now: () => Date;
  readonly call: (
    caller: ToolCaller,
    params: {
      uploadId: string;
      name: string;
      mediaType: string;
      size: number;
      checksum: string;
    },
  ) => Promise<unknown>;
}): AttachmentIngress {
  const stages = new Map<string, StagedUpload>();
  const done = new Map<string, ImportedAttachment>();
  const inflight = new Map<string, Promise<ImportedAttachment>>();

  const same = (stage: StagedUpload, chunk: AttachmentChunk): boolean =>
    stage.botId === chunk.botId &&
    stage.name === chunk.name &&
    stage.mediaType === chunk.mediaType &&
    stage.size === chunk.size &&
    stage.checksum === chunk.checksum &&
    stage.count === chunk.count;

  const finish = (uploadId: string, chunk: AttachmentChunk): Promise<ImportedAttachment> => {
    const existing = inflight.get(uploadId);
    if (existing !== undefined) return existing;
    const run = (async () => {
      try {
        const stage = stages.get(uploadId);
        if (stage === undefined) {
          throw new EngineError({
            code: "INVALID_INPUT",
            message: "attachment upload is incomplete",
            retryable: false,
          });
        }
        const parts: Buffer[] = [];
        for (let index = 0; index < stage.count; index += 1) {
          const part = stage.chunks.get(index);
          if (part === undefined) {
            throw new EngineError({
              code: "INVALID_INPUT",
              message: "attachment upload is incomplete",
              retryable: false,
            });
          }
          parts.push(part);
        }
        const bytes = Buffer.concat(parts);
        if (bytes.byteLength !== stage.size) {
          throw new EngineError({
            code: "INVALID_INPUT",
            message: "attachment size does not match the staged bytes",
            retryable: false,
          });
        }
        const checksum = createHash("sha256").update(bytes).digest("hex");
        if (checksum !== stage.checksum) {
          throw new EngineError({
            code: "INVALID_INPUT",
            message: "attachment checksum does not match the staged bytes",
            retryable: false,
          });
        }
        options.bytes.put(uploadId, chunk.botId, bytes);
        try {
          const result = (await options.call(
            {
              id: `ui:${chunk.botId}`,
              botId: chunk.botId,
              sessionId: `chat:${chunk.botId}`,
            },
            {
              uploadId,
              name: chunk.name,
              mediaType: chunk.mediaType,
              size: chunk.size,
              checksum: chunk.checksum,
            },
          )) as ImportedAttachment;
          if (result.checksum !== checksum || result.size !== bytes.byteLength) {
            throw new EngineError({
              code: "INVALID_INPUT",
              message: "imported attachment does not match the staged bytes",
              retryable: false,
            });
          }
          done.set(uploadId, result);
          return result;
        } finally {
          options.bytes.drop(uploadId);
        }
      } finally {
        stages.delete(uploadId);
      }
    })();
    inflight.set(uploadId, run);
    // The caller awaits `run`. This cleanup chain must not surface a second rejection.
    void run.finally(() => inflight.delete(uploadId)).catch(() => undefined);
    return run;
  };

  return {
    async accept(chunk) {
      const finished = done.get(chunk.uploadId);
      if (finished !== undefined) {
        if (finished.size !== chunk.size || chunk.botId.length === 0) {
          throw new EngineError({
            code: "INVALID_INPUT",
            message: "attachment upload was already imported",
            retryable: false,
          });
        }
        return { status: "imported", ...finished };
      }
      const expectedCount = Math.ceil(chunk.size / ATTACHMENT_CHUNK_RAW_BYTES);
      if (chunk.count !== expectedCount || chunk.index >= chunk.count) {
        throw new EngineError({
          code: "INVALID_INPUT",
          message: "attachment chunk index is outside the file",
          retryable: false,
        });
      }
      const decoded = decodeChunk(chunk.data);
      const last = chunk.index === chunk.count - 1;
      const expectedLast = chunk.size - (chunk.count - 1) * ATTACHMENT_CHUNK_RAW_BYTES;
      if (
        last
          ? decoded.byteLength !== expectedLast
          : decoded.byteLength !== ATTACHMENT_CHUNK_RAW_BYTES
      ) {
        throw new EngineError({
          code: "INVALID_INPUT",
          message: "attachment chunk length does not match the file size",
          retryable: false,
        });
      }
      const nowMs = options.now().getTime();
      let stage = stages.get(chunk.uploadId);
      if (stage !== undefined && stage.expiresAt <= nowMs) {
        stages.delete(chunk.uploadId);
        stage = undefined;
      }
      if (stage === undefined) {
        stage = {
          botId: chunk.botId,
          name: chunk.name,
          mediaType: chunk.mediaType,
          size: chunk.size,
          checksum: chunk.checksum,
          count: chunk.count,
          chunks: new Map(),
          expiresAt: nowMs + UPLOAD_TTL_MS,
        };
        stages.set(chunk.uploadId, stage);
      } else if (!same(stage, chunk)) {
        throw new EngineError({
          code: "INVALID_INPUT",
          message: "attachment chunk does not match the upload",
          retryable: false,
        });
      }
      const previous = stage.chunks.get(chunk.index);
      if (previous !== undefined && !previous.equals(decoded)) {
        throw new EngineError({
          code: "INVALID_INPUT",
          message: "attachment chunk was resent with different bytes",
          retryable: false,
        });
      }
      stage.chunks.set(chunk.index, decoded);
      if (stage.chunks.size < stage.count) {
        return { status: "staged", received: stage.chunks.size };
      }
      try {
        const imported = await finish(chunk.uploadId, chunk);
        return { status: "imported", ...imported };
      } catch (error) {
        stages.delete(chunk.uploadId);
        options.bytes.drop(chunk.uploadId);
        throw error;
      }
    },
  };
}
