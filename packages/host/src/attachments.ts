/**
 * D26 attachment upload store and workspace file reader.
 *
 * Uploads arrive as trusted desktop `attachment.begin/append/commit` calls.
 * Bytes stage under `<data root>/cache/attachments-staging/` (chunked because
 * one envelope stays capped at 1 MiB) and commit into the bot workspace's
 * `attachments/` directory — the same directory the bot's own filesystem view
 * sees, so `read_workspace_file` serves them without a second channel.
 *
 * This module never trusts model input: the bot identity comes from the DB
 * row, paths are clamped inside the workspace root (realpath walk, same
 * discipline as the D28 artifacts service), binaries and oversize files are
 * rejected explicitly instead of truncated, and failed/abandoned staging
 * files are swept on construction and shutdown.
 */
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { MAX_ARTIFACT_CONTENT_BYTES, MAX_ATTACHMENT_BYTES, MAX_ATTACHMENT_CHUNK_BYTES } from "@deepseek-bot/contracts";
import { EngineError } from "@deepseek-bot/runtime";
import { getBot, getWorkspace, type OpenedDatabase } from "@deepseek-bot/storage";

export const ATTACHMENTS_DIR = "attachments";
/** Inline cap for one `read_workspace_file` result (same budget as artifacts.read). */
const MAX_WORKSPACE_READ_BYTES = MAX_ARTIFACT_CONTENT_BYTES;

export interface AttachmentUploadResult {
  readonly botId: string;
  /** Workspace-relative posix path of the stored file. */
  readonly path: string;
  readonly size: number;
  readonly checksum: string;
}

export interface WorkspaceFileContent {
  readonly path: string;
  readonly content: string;
}

function invalid(message: string, details?: Record<string, unknown>): EngineError {
  return new EngineError({
    code: "INVALID_INPUT",
    message,
    ...(details !== undefined ? { details } : {}),
    retryable: false,
  });
}

function unauthorizedPath(message: string, details?: Record<string, unknown>): EngineError {
  return new EngineError({
    code: "UNAUTHORIZED_PATH",
    message,
    ...(details !== undefined ? { details } : {}),
    retryable: false,
  });
}

/** Re-sanitize a schema-validated name: defense in depth for the filesystem. */
function safeFileName(name: string): string {
  if (name.length === 0 || name.length > 200 || name.startsWith(".")) {
    throw invalid("attachment name is not a usable file name", { name });
  }
  if (
    /[\\/]/.test(name) ||
    // eslint-disable-next-line no-control-regex -- the sanitizer must detect control characters
    /[\u0000-\u001f\u007f]/.test(name)
  ) {
    throw invalid("attachment name must be a single path segment", { name });
  }
  return name;
}

interface PendingUpload {
  readonly botId: string;
  readonly name: string;
  readonly size: number;
  readonly sha256: string;
  readonly stagingPath: string;
  received: number;
}

export interface AttachmentStoreOptions {
  readonly db: OpenedDatabase;
  /** Cache dir of the data root; staging lives in `attachments-staging/`. */
  readonly cacheDir: string;
}

export interface AttachmentStore {
  begin(botId: string, name: string, size: number, sha256: string): string;
  append(uploadId: string, chunkBase64: string): number;
  commit(uploadId: string): AttachmentUploadResult;
  /** Remove staging files; called on shutdown (startup sweeps on construction). */
  close(): void;
}

export function createAttachmentStore({ db, cacheDir }: AttachmentStoreOptions): AttachmentStore {
  const stagingDir = path.join(cacheDir, "attachments-staging");
  fs.mkdirSync(stagingDir, { recursive: true });
  // Startup sweep: staging files from a crashed previous process are stale.
  for (const entry of fs.readdirSync(stagingDir)) {
    try {
      fs.rmSync(path.join(stagingDir, entry), { force: true });
    } catch {
      // A locked leftover must not block startup; the next sweep retries.
    }
  }

  const pending = new Map<string, PendingUpload>();

  const requireWorkspaceRoot = (botId: string): string => {
    const bot = getBot(db, botId);
    if (bot === undefined) throw invalid(`bot '${botId}' was not found`);
    if (bot.archivedAt !== null) throw invalid("archived bots have no workspace");
    const workspace = getWorkspace(db, bot.workspaceId);
    if (workspace === undefined) {
      throw invalid(`workspace '${bot.workspaceId}' was not found`);
    }
    let stat: fs.Stats;
    try {
      stat = fs.statSync(workspace.canonicalPath);
    } catch {
      throw invalid("bot workspace directory does not exist", {
        workspaceId: bot.workspaceId,
      });
    }
    if (!stat.isDirectory()) {
      throw invalid("bot workspace is not a directory", { workspaceId: bot.workspaceId });
    }
    return workspace.canonicalPath;
  };

  const discard = (uploadId: string): void => {
    const upload = pending.get(uploadId);
    if (upload !== undefined) {
      try {
        fs.rmSync(upload.stagingPath, { force: true });
      } catch {
        // Best-effort cleanup; the startup sweep removes strays.
      }
      pending.delete(uploadId);
    }
  };

  return {
    begin(botId, name, size, sha256) {
      requireWorkspaceRoot(botId);
      const safeName = safeFileName(name);
      if (size < 1 || size > MAX_ATTACHMENT_BYTES) {
        throw invalid("attachment size is outside the contract limit", { size });
      }
      const uploadId = randomUUID();
      const stagingPath = path.join(stagingDir, `${uploadId}.part`);
      fs.writeFileSync(stagingPath, Buffer.alloc(0));
      pending.set(uploadId, {
        botId,
        name: safeName,
        size,
        sha256,
        stagingPath,
        received: 0,
      });
      return uploadId;
    },

    append(uploadId, chunkBase64) {
      const upload = pending.get(uploadId);
      if (upload === undefined) {
        throw invalid("attachment upload was not started or already finished", { uploadId });
      }
      let chunk: Buffer;
      try {
        chunk = Buffer.from(chunkBase64, "base64");
      } catch {
        chunk = Buffer.alloc(0);
      }
      if (chunk.length < 1 || chunk.length > MAX_ATTACHMENT_CHUNK_BYTES) {
        throw invalid("attachment chunk is empty or above the chunk limit", {
          received: upload.received,
        });
      }
      if (upload.received + chunk.length > upload.size) {
        discard(uploadId);
        throw invalid("attachment chunks exceed the declared size", {
          declared: upload.size,
          received: upload.received + chunk.length,
        });
      }
      fs.appendFileSync(upload.stagingPath, chunk);
      upload.received += chunk.length;
      return upload.received;
    },

    commit(uploadId) {
      const upload = pending.get(uploadId);
      if (upload === undefined) {
        throw invalid("attachment upload was not started or already finished", { uploadId });
      }
      let bytes: Buffer;
      try {
        bytes = fs.readFileSync(upload.stagingPath);
      } catch {
        discard(uploadId);
        throw invalid("attachment staging file disappeared", { uploadId });
      }
      const finish = (error: EngineError): never => {
        discard(uploadId);
        throw error;
      };
      if (upload.received !== upload.size || bytes.byteLength !== upload.size) {
        return finish(
          invalid("attachment size does not match the declared size", {
            declared: upload.size,
            received: upload.received,
          }),
        );
      }
      const checksum = createHash("sha256").update(bytes).digest("hex");
      if (checksum !== upload.sha256) {
        return finish(
          invalid("attachment checksum does not match the declared sha256", { uploadId }),
        );
      }
      const workspaceRoot = requireWorkspaceRoot(upload.botId);
      const attachmentsDir = path.join(workspaceRoot, ATTACHMENTS_DIR);
      try {
        fs.mkdirSync(attachmentsDir, { recursive: true });
      } catch {
        return finish(invalid("bot workspace attachments directory could not be created"));
      }
      // Unique file name per bot: keep the user's name, suffix only collisions.
      const extension = path.extname(upload.name);
      const stem = upload.name.slice(0, upload.name.length - extension.length);
      let target = path.join(attachmentsDir, upload.name);
      let suffix = 0;
      while (fs.existsSync(target)) {
        suffix += 1;
        target = path.join(attachmentsDir, `${stem}-${suffix}${extension}`);
      }
      try {
        fs.renameSync(upload.stagingPath, target);
      } catch {
        return finish(invalid("attachment could not be moved into the workspace"));
      }
      pending.delete(uploadId);
      return {
        botId: upload.botId,
        path: `${ATTACHMENTS_DIR}/${path.basename(target)}`,
        size: bytes.byteLength,
        checksum,
      };
    },

    close() {
      for (const uploadId of [...pending.keys()]) {
        discard(uploadId);
      }
    },
  };
}

/**
 * Host-side reader behind the `read_workspace_file` tool: clamps the path
 * inside the bot workspace (realpath walk against symlink escapes), refuses
 * hidden entries, directories, oversize files and binary content explicitly.
 */
export function readWorkspaceFileText(
  db: OpenedDatabase,
  botId: string,
  relativePath: string,
): WorkspaceFileContent {
  const bot = getBot(db, botId);
  if (bot === undefined) throw invalid(`bot '${botId}' was not found`);
  if (bot.archivedAt !== null) throw invalid("archived bots have no workspace");
  const workspace = getWorkspace(db, bot.workspaceId);
  if (workspace === undefined) {
    throw invalid(`workspace '${bot.workspaceId}' was not found`);
  }
  const root = workspace.canonicalPath;
  const segments = relativePath.split(/[\\/]/);
  if (
    relativePath.length === 0 ||
    segments.some((segment) => segment.length === 0 || segment === "." || segment === "..") ||
    segments.some((segment) => segment.startsWith("."))
  ) {
    throw unauthorizedPath("workspace file path must stay inside the bot workspace", {
      path: relativePath,
    });
  }
  const absolute = path.resolve(root, ...segments);
  const rel = path.relative(root, absolute);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) {
    throw unauthorizedPath("workspace file path escapes the bot workspace", {
      path: relativePath,
    });
  }
  // Walk up to the deepest existing ancestor and compare real paths, so a
  // symlinked directory cannot carry the read outside the workspace.
  let probe = absolute;
  while (!fs.existsSync(probe)) {
    const parent = path.dirname(probe);
    if (parent === probe) {
      throw invalid("workspace file does not exist", { path: relativePath });
    }
    probe = parent;
  }
  const realRoot = fs.realpathSync(root);
  const realProbe = fs.realpathSync(probe);
  if (realProbe !== realRoot && !realProbe.startsWith(realRoot + path.sep)) {
    throw unauthorizedPath("workspace file path escapes the bot workspace", {
      path: relativePath,
    });
  }
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(absolute);
  } catch {
    throw invalid("workspace file does not exist", { path: relativePath });
  }
  if (!stat.isFile()) {
    throw invalid("workspace path is not a regular file", { path: relativePath });
  }
  if (stat.size > MAX_WORKSPACE_READ_BYTES) {
    throw invalid(
      `workspace file exceeds the ${MAX_WORKSPACE_READ_BYTES} byte inline read cap and was not truncated`,
      { path: relativePath, size: stat.size },
    );
  }
  const bytes = fs.readFileSync(absolute);
  if (bytes.includes(0)) {
    throw invalid("workspace file is binary and cannot be read as text", {
      path: relativePath,
    });
  }
  let content: string;
  try {
    content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw invalid("workspace file is not valid UTF-8 text", { path: relativePath });
  }
  return {
    path: segments.join("/"),
    content,
  };
}
