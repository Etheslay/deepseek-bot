/**
 * Bot workspace artifact co-edit service (D28).
 *
 * "Artifact" for the sidecar means one editable file in the bot's workspace
 * directory (`workspaces.canonical_path`): the Harness writes bot output
 * there through its filesystem tools, so a user save that lands in the same
 * file is exactly what the bot reads on its next turn — the co-write loop
 * needs no extra channel.
 *
 * Version trail: the `artifact_versions` table (migration 0010) stores
 * metadata; snapshot content lives under
 * `<root>/artifacts/coedit-versions/<botId>/<versionId>.bin`. The Harness
 * writes workspace files directly (no method call observes it), so every
 * list/read/versions call first *reconciles*: a workspace file whose
 * checksum differs from the latest recorded version is captured as a "bot"
 * version. Saves and reverts record "user" versions; reverts never rewrite
 * history — they append.
 *
 * Path safety: request paths already pass RelativeArtifactPathSchema (no
 * absolute forms, no `.`/`..`); resolution additionally pins the target
 * inside the workspace root via path.relative containment plus a
 * realpath walk of the deepest existing ancestor, defeating symlink and
 * reparse-point escapes. Hidden entries (`.`-prefixed) and symlinks are
 * never listed or followed.
 */
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  MAX_ARTIFACT_CONTENT_BYTES,
  artifactMediaTypeForPath,
  isTextEditableMediaType,
  type ArtifactVersion,
  type BotArtifact,
} from "@deepseek-bot/contracts";
import { EngineError } from "@deepseek-bot/runtime";
import {
  getArtifactVersion,
  getArtifactVersionContentPath,
  getBot,
  getWorkspace,
  insertArtifactVersion,
  latestArtifactVersion,
  listArtifactVersions,
  nextArtifactRevision,
  pruneArtifactVersions,
  type OpenedDatabase,
} from "@deepseek-bot/storage";

/** Keep at most this many versions per (bot, file); oldest pruned on insert. */
const MAX_VERSIONS_PER_FILE = 50;
/** Listing caps: enough for a real workspace, bounded enough for one envelope. */
const MAX_LISTED_FILES = 200;
const MAX_LIST_DEPTH = 8;
/** Workspace files larger than this are listed but refuse inline content. */
const MAX_INLINE_FILE_BYTES = MAX_ARTIFACT_CONTENT_BYTES;

const COEDIT_VERSIONS_DIR = "coedit-versions";

export interface WorkspaceArtifacts {
  list(botId: string): { artifacts: BotArtifact[] };
  read(
    botId: string,
    relativePath: string,
  ): { kind: "text"; mediaType: string; checksum: BotArtifact["checksum"]; content: string } | { kind: "blocked"; mediaType: string; reason: string };
  save(
    botId: string,
    relativePath: string,
    content: string,
    expectedChecksum: string | undefined,
  ): { artifact: BotArtifact; version: ArtifactVersion };
  versions(botId: string, relativePath: string): { versions: ArtifactVersion[] };
  versionContent(
    botId: string,
    relativePath: string,
    versionId: string,
  ): { kind: "text"; mediaType: string; content: string } | { kind: "blocked"; mediaType: string; reason: string };
  revert(
    botId: string,
    relativePath: string,
    versionId: string,
  ): { artifact: BotArtifact; version: ArtifactVersion };
}

interface HostArtifactsDeps {
  readonly db: OpenedDatabase;
  /** Data root; version snapshots go to `<root>/artifacts/coedit-versions/`. */
  readonly artifactsRoot: string;
  readonly now: () => Date;
}

function invalid(message: string, details?: Record<string, unknown>): EngineError {
  return new EngineError({
    code: "INVALID_INPUT",
    message,
    ...(details !== undefined ? { details } : {}),
    retryable: false,
  });
}

function conflict(message: string, details?: Record<string, unknown>): EngineError {
  return new EngineError({
    code: "REVISION_CONFLICT",
    message,
    ...(details !== undefined ? { details } : {}),
    retryable: false,
  });
}

function sha256Bytes(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function coeditVersionsRoot(artifactsRoot: string): string {
  return path.join(artifactsRoot, COEDIT_VERSIONS_DIR);
}

/**
 * Resolve a schema-validated relative path to an absolute path pinned inside
 * `root`. Returns the resolved path plus a flag telling whether the target
 * already exists (and is a regular file, not a symlink/reparse point).
 */
function resolveInsideWorkspace(
  root: string,
  relativePath: string,
): { absolute: string; exists: boolean } {
  const absolute = path.resolve(root, relativePath);
  const rel = path.relative(root, absolute);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) {
    throw invalid("artifact path escapes the bot workspace", { path: relativePath });
  }
  // Walk up to the deepest existing ancestor and compare real paths, so a
  // symlinked directory cannot carry the target outside the workspace.
  let probe = absolute;
  while (!fs.existsSync(probe)) {
    const parent = path.dirname(probe);
    if (parent === probe) {
      throw invalid("artifact path escapes the bot workspace", { path: relativePath });
    }
    probe = parent;
  }
  const realRoot = fs.realpathSync(root);
  const realProbe = fs.realpathSync(probe);
  if (realProbe !== realRoot && !realProbe.startsWith(realRoot + path.sep)) {
    throw invalid("artifact path escapes the bot workspace", { path: relativePath });
  }
  if (fs.existsSync(absolute)) {
    const lstat = fs.lstatSync(absolute);
    if (!lstat.isFile()) {
      throw invalid("artifact path is not a regular file", { path: relativePath });
    }
    return { absolute, exists: true };
  }
  return { absolute, exists: false };
}

function artifactFromBytes(root: string, absolutePath: string, stat: fs.Stats, bytes: Buffer): BotArtifact {
  const relativePath = path.relative(root, absolutePath).split(path.sep).join("/");
  return {
    relativePath,
    mediaType: artifactMediaTypeForPath(relativePath),
    size: stat.size,
    updatedAt: stat.mtime.toISOString(),
    checksum: { algorithm: "sha256", value: sha256Bytes(bytes) },
  };
}

function listFilesRecursive(root: string, current: string, depth: number, out: string[]): void {
  if (out.length >= MAX_LISTED_FILES || depth > MAX_LIST_DEPTH) {
    return;
  }
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(current, { withFileTypes: true });
  } catch {
    return; // Unreadable subtree counts as empty instead of failing the list.
  }
  for (const entry of entries) {
    if (out.length >= MAX_LISTED_FILES) {
      return;
    }
    if (entry.name.startsWith(".") || entry.isSymbolicLink()) {
      continue;
    }
    const child = path.join(current, entry.name);
    if (entry.isDirectory()) {
      listFilesRecursive(root, child, depth + 1, out);
    } else if (entry.isFile()) {
      out.push(child);
    }
  }
}

export function createWorkspaceArtifacts(deps: HostArtifactsDeps): WorkspaceArtifacts {
  const { db } = deps;
  const versionsRoot = coeditVersionsRoot(deps.artifactsRoot);

  const requireBotWorkspace = (botId: string): string => {
    const bot = getBot(db, botId);
    if (bot === undefined) {
      throw invalid(`bot '${botId}' was not found`);
    }
    if (bot.archivedAt !== null) {
      throw invalid("archived bots have no editable workspace");
    }
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

  /** Append one version row + snapshot file. Returns the stored version. */
  const recordVersion = (
    botId: string,
    artifact: BotArtifact,
    content: Buffer,
    author: "user" | "bot",
  ): ArtifactVersion => {
    const botDir = path.join(versionsRoot, botId);
    fs.mkdirSync(botDir, { recursive: true });
    const versionId = randomUUID();
    const contentPath = path.join(botDir, `${versionId}.bin`);
    fs.writeFileSync(contentPath, content);
    const revision = nextArtifactRevision(db, botId, artifact.relativePath);
    try {
      return insertArtifactVersion(db, {
        id: versionId,
        botId,
        relativePath: artifact.relativePath,
        revision,
        author,
        mediaType: artifact.mediaType,
        size: artifact.size,
        checksumValue: artifact.checksum.value,
        contentPath,
      });
    } catch (error) {
      try {
        fs.unlinkSync(contentPath);
      } catch {
        // Orphan snapshot without a row; harmless, cleanup is best-effort.
      }
      throw error;
    } finally {
      const pruned = pruneArtifactVersions(db, botId, artifact.relativePath, MAX_VERSIONS_PER_FILE);
      for (const orphan of pruned) {
        try {
          fs.unlinkSync(orphan);
        } catch {
          // Already gone or unreadable; the metadata row is the source of truth.
        }
      }
    }
  };

  /**
   * Capture workspace content that no version records yet as a "bot" version.
   * Runs before every read-shaped call so the trail reflects Harness writes.
   */
  const reconcile = (botId: string, workspacePath: string, relativePath: string): BotArtifact | null => {
    const { absolute, exists } = resolveInsideWorkspace(workspacePath, relativePath);
    if (!exists) {
      return null;
    }
    const bytes = fs.readFileSync(absolute);
    const artifact = artifactFromBytes(workspacePath, absolute, fs.statSync(absolute), bytes);
    const latest = latestArtifactVersion(db, botId, relativePath);
    if (latest !== undefined && latest.checksum.value === artifact.checksum.value) {
      return artifact;
    }
    recordVersion(botId, artifact, bytes, "bot");
    return artifact;
  };

  return {
    list(botId) {
      const workspacePath = requireBotWorkspace(botId);
      const files: string[] = [];
      listFilesRecursive(workspacePath, workspacePath, 1, files);
      const artifacts: BotArtifact[] = [];
      for (const absolute of files) {
        const relativePath = path.relative(workspacePath, absolute).split(path.sep).join("/");
        const artifact = reconcile(botId, workspacePath, relativePath);
        if (artifact !== null) {
          artifacts.push(artifact);
        }
      }
      artifacts.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
      return { artifacts };
    },

    read(botId, relativePath) {
      const workspacePath = requireBotWorkspace(botId);
      const artifact = reconcile(botId, workspacePath, relativePath);
      if (artifact === null) {
        throw invalid("artifact does not exist", { path: relativePath });
      }
      const { absolute } = resolveInsideWorkspace(workspacePath, relativePath);
      if (artifact.size > MAX_INLINE_FILE_BYTES) {
        return {
          kind: "blocked",
          mediaType: artifact.mediaType,
          reason: `文件超过 ${MAX_INLINE_FILE_BYTES} 字节，不能在画布中打开（可继续用列表与版本历史）。`,
        };
      }
      if (!isTextEditableMediaType(artifact.mediaType)) {
        return {
          kind: "blocked",
          mediaType: artifact.mediaType,
          reason:
            artifact.mediaType === "text/html"
              ? "HTML 不做内联编辑/渲染（防脚本执行）。"
              : `mediaType ${artifact.mediaType} 不是可编辑文本。`,
        };
      }
      return {
        kind: "text",
        mediaType: artifact.mediaType,
        checksum: artifact.checksum,
        content: fs.readFileSync(absolute, { encoding: "utf8" }),
      };
    },

    save(botId, relativePath, content, expectedChecksum) {
      const workspacePath = requireBotWorkspace(botId);
      const bytes = Buffer.from(content, "utf8");
      if (bytes.byteLength > MAX_ARTIFACT_CONTENT_BYTES) {
        throw invalid(
          `保存内容超过 ${MAX_ARTIFACT_CONTENT_BYTES} 字节上限，已拒绝（未截断、未写入）。`,
          { path: relativePath },
        );
      }
      const mediaType = artifactMediaTypeForPath(relativePath);
      if (!isTextEditableMediaType(mediaType)) {
        throw invalid(
          mediaType === "text/html"
            ? "HTML 不支持画布编辑（防脚本执行）。"
            : `mediaType ${mediaType} 不支持画布编辑。`,
          { path: relativePath },
        );
      }
      const { absolute, exists } = resolveInsideWorkspace(workspacePath, relativePath);
      if (exists) {
        // Reconcile first: a concurrent bot write becomes a "bot" version and
        // the optimistic check below compares against the file on disk.
        const onDisk = fs.readFileSync(absolute);
        const current = artifactFromBytes(workspacePath, absolute, fs.statSync(absolute), onDisk);
        if (current.checksum.value !== latestArtifactChecksum(db, botId, relativePath)) {
          recordVersion(botId, current, onDisk, "bot");
        }
        if (
          expectedChecksum !== undefined &&
          current.checksum.value !== expectedChecksum
        ) {
          throw conflict("文件在编辑期间被修改（可能来自 bot），请刷新后再保存。", {
            path: relativePath,
          });
        }
        if (current.checksum.value === sha256Bytes(bytes)) {
          // Content already on disk: no duplicate version for a no-op save.
          const latest = latestArtifactVersion(db, botId, relativePath);
          if (latest !== undefined) {
            return { artifact: current, version: latest };
          }
        }
      } else if (
        expectedChecksum !== undefined &&
        expectedChecksum !== sha256Bytes(Buffer.alloc(0))
      ) {
        throw conflict("文件已不存在，无法按编辑基准保存。", { path: relativePath });
      }
      fs.mkdirSync(path.dirname(absolute), { recursive: true });
      const temporary = `${absolute}.d28-tmp-${randomUUID()}`;
      fs.writeFileSync(temporary, bytes);
      try {
        fs.renameSync(temporary, absolute);
      } catch (error) {
        try {
          fs.unlinkSync(temporary);
        } catch {
          // Best-effort cleanup of the failed write.
        }
        throw error;
      }
      const artifactBytes = fs.readFileSync(absolute);
      const artifact = artifactFromBytes(workspacePath, absolute, fs.statSync(absolute), artifactBytes);
      const version = recordVersion(botId, artifact, artifactBytes, "user");
      return { artifact, version };
    },

    versions(botId, relativePath) {
      const workspacePath = requireBotWorkspace(botId);
      reconcile(botId, workspacePath, relativePath);
      return { versions: listArtifactVersions(db, botId, relativePath) };
    },

    versionContent(botId, relativePath, versionId) {
      requireBotWorkspace(botId);
      const version = getOwnedVersion(db, botId, relativePath, versionId);
      if (!isTextEditableMediaType(version.mediaType)) {
        return {
          kind: "blocked",
          mediaType: version.mediaType,
          reason: `mediaType ${version.mediaType} 没有可预览的文本内容。`,
        };
      }
      let bytes: Buffer;
      try {
        bytes = fs.readFileSync(version.contentPath);
      } catch {
        throw invalid("version snapshot file is missing", { versionId });
      }
      return {
        kind: "text",
        mediaType: version.mediaType,
        content: bytes.toString("utf8"),
      };
    },

    revert(botId, relativePath, versionId) {
      const workspacePath = requireBotWorkspace(botId);
      const version = getOwnedVersion(db, botId, relativePath, versionId);
      let bytes: Buffer;
      try {
        bytes = fs.readFileSync(version.contentPath);
      } catch {
        throw invalid("version snapshot file is missing", { versionId });
      }
      const { absolute } = resolveInsideWorkspace(workspacePath, relativePath);
      fs.mkdirSync(path.dirname(absolute), { recursive: true });
      const temporary = `${absolute}.d28-tmp-${randomUUID()}`;
      fs.writeFileSync(temporary, bytes);
      try {
        fs.renameSync(temporary, absolute);
      } catch (error) {
        try {
          fs.unlinkSync(temporary);
        } catch {
          // Best-effort cleanup of the failed write.
        }
        throw error;
      }
      const artifactBytes = fs.readFileSync(absolute);
      const artifact = artifactFromBytes(workspacePath, absolute, fs.statSync(absolute), artifactBytes);
      const revertVersion = recordVersion(botId, artifact, artifactBytes, "user");
      return { artifact, version: revertVersion };
    },
  };

  function latestArtifactChecksum(
    database: OpenedDatabase,
    botId: string,
    relativePath: string,
  ): string | undefined {
    return latestArtifactVersion(database, botId, relativePath)?.checksum.value;
  }
}

function getOwnedVersion(
  db: OpenedDatabase,
  botId: string,
  relativePath: string,
  versionId: string,
): ArtifactVersion & { readonly contentPath: string } {
  const version = getArtifactVersion(db, versionId);
  if (
    version === undefined ||
    version.botId !== botId ||
    version.relativePath !== relativePath
  ) {
    throw invalid("artifact version was not found for this file", { versionId });
  }
  const contentPath = getArtifactVersionContentPath(db, versionId);
  if (contentPath === undefined) {
    throw invalid("artifact version snapshot path is missing", { versionId });
  }
  return { ...version, contentPath };
}
