/**
 * Download the pinned whisper.cpp CLI and ggml model into
 * apps/desktop/resources/whisper/dist.
 *
 * Desktop dev and Windows packaging run this. voice.transcribe never does:
 * it only spawns the files this script already checked. Re-running with a
 * matching stamp skips the network. Archives stay in resources/whisper/cache
 * (gitignored) so a platform switch does not download the model again.
 *
 *   node apps/desktop/scripts/fetch-whisper.mts
 *   node apps/desktop/scripts/fetch-whisper.mts --platform win32
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { chmod, copyFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gunzipSync, inflateRawSync } from "node:zlib";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const whisperRoot = resolve(scriptDir, "../resources/whisper");
const pinsPath = join(whisperRoot, "pins.json");
const cacheDir = join(whisperRoot, "cache");
const distDir = join(whisperRoot, "dist");

const MAX_ENTRY_BYTES = 8 * 1024 * 1024;
const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;

export type WhisperPins = {
  whisperCppVersion: string;
  license: { file: string; url: string; sha256: string };
  model: { file: string; url: string; sha256: string };
  cli: Record<string, CliPin>;
};

export type CliPin = {
  url: string;
  sha256: string;
  format: "zip" | "tar.gz";
  binary: string;
  include: string[];
};

type ArchiveEntry = {
  name: string;
  data?: Buffer;
  link?: string;
};

export function entryKept(archiveName: string, prefixes: readonly string[]): boolean {
  const base = safeBaseName(archiveName);
  if (base === undefined) return false;
  return prefixes.some((prefix) => base === prefix || base.startsWith(prefix));
}

export function extractZip(buffer: Buffer, dest: string, prefixes: readonly string[]): string[] {
  return writeEntries(readZip(buffer), dest, prefixes);
}

export function extractTarGz(buffer: Buffer, dest: string, prefixes: readonly string[]): string[] {
  let tar: Buffer;
  try {
    tar = gunzipSync(buffer);
  } catch {
    throw new Error("whisper archive is not gzip");
  }
  return writeEntries(readTar(tar), dest, prefixes);
}

export async function fetchWhisper(options: {
  platform?: string;
  arch?: string;
  pinsPath?: string;
  cacheDir?: string;
  distDir?: string;
} = {}): Promise<void> {
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const pinsFile = options.pinsPath ?? pinsPath;
  const cache = options.cacheDir ?? cacheDir;
  const dist = options.distDir ?? distDir;
  const pins = parsePins(JSON.parse(await readFile(pinsFile, "utf8")));
  const key = `${platform}-${arch}`;
  const cli = pins.cli[key];
  if (cli === undefined) {
    throw new Error(
      `no pinned whisper.cpp build for ${key}; add one to apps/desktop/resources/whisper/pins.json`,
    );
  }
  await mkdir(cache, { recursive: true });
  const modelCache = await ensureDownloaded(
    pins.model.url,
    pins.model.sha256,
    join(cache, pins.model.file),
  );
  const licenseCache = await ensureDownloaded(
    pins.license.url,
    pins.license.sha256,
    join(cache, pins.license.file),
  );
  const archiveName = `${key}-${sha256Prefix(cli.sha256)}.${cli.format === "zip" ? "zip" : "tar.gz"}`;
  const archiveCache = await ensureDownloaded(cli.url, cli.sha256, join(cache, archiveName));
  if (await stampMatches(dist, pins.whisperCppVersion, key, cli, pins.model)) {
    return;
  }
  await rm(dist, { recursive: true, force: true });
  await mkdir(dist, { recursive: true });
  await copyFile(modelCache, join(dist, pins.model.file));
  await copyFile(licenseCache, join(dist, pins.license.file));
  const archive = await readFile(archiveCache);
  const written =
    cli.format === "zip"
      ? extractZip(archive, dist, cli.include)
      : extractTarGz(archive, dist, cli.include);
  if (!written.includes(cli.binary)) {
    throw new Error(`whisper archive did not contain ${cli.binary}`);
  }
  if (platform !== "win32") {
    await chmod(join(dist, cli.binary), 0o755);
  }
  const stamp = {
    whisperCppVersion: pins.whisperCppVersion,
    platform: key,
    archiveSha256: cli.sha256,
    modelSha256: pins.model.sha256,
    binary: cli.binary,
    model: pins.model.file,
  };
  await writeFile(join(dist, "bundle.json"), `${JSON.stringify(stamp, null, 2)}\n`);
}

function sha256Prefix(hex: string): string {
  return hex.slice(0, 12);
}

async function stampMatches(
  dist: string,
  version: string,
  platform: string,
  cli: CliPin,
  model: WhisperPins["model"],
): Promise<boolean> {
  const stampPath = join(dist, "bundle.json");
  if (!existsSync(stampPath) || !existsSync(join(dist, cli.binary)) || !existsSync(join(dist, model.file))) {
    return false;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(stampPath, "utf8"));
  } catch {
    return false;
  }
  if (typeof parsed !== "object" || parsed === null) return false;
  const stamp = parsed as Record<string, unknown>;
  return (
    stamp.whisperCppVersion === version &&
    stamp.platform === platform &&
    stamp.archiveSha256 === cli.sha256 &&
    stamp.modelSha256 === model.sha256 &&
    stamp.binary === cli.binary &&
    stamp.model === model.file
  );
}

async function ensureDownloaded(url: string, sha256: string, dest: string): Promise<string> {
  if (existsSync(dest) && sha256Of(await readFile(dest)) === sha256) {
    return dest;
  }
  const partial = `${dest}.partial`;
  const response = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(120_000),
    headers: { "user-agent": "deepseek-bot-whisper-fetch" },
  });
  if (!response.ok || response.body === null) {
    throw new Error(`download failed (${response.status}) for ${url}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  const digest = sha256Of(bytes);
  if (digest !== sha256) {
    await rm(partial, { force: true });
    throw new Error(`sha256 mismatch for ${url}: expected ${sha256}, got ${digest}`);
  }
  await writeFile(partial, bytes);
  await rename(partial, dest);
  return dest;
}

function sha256Of(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function parsePins(value: unknown): WhisperPins {
  if (typeof value !== "object" || value === null) {
    throw new Error("whisper pins are unreadable");
  }
  const record = value as Record<string, unknown>;
  const version = record.whisperCppVersion;
  const license = asNamedFile(record.license, "license");
  const model = asNamedFile(record.model, "model");
  if (typeof version !== "string" || version.length === 0) {
    throw new Error("whisper pins are missing whisperCppVersion");
  }
  if (typeof record.cli !== "object" || record.cli === null) {
    throw new Error("whisper pins are missing cli");
  }
  const cli: Record<string, CliPin> = {};
  for (const [key, raw] of Object.entries(record.cli as Record<string, unknown>)) {
    cli[key] = asCliPin(raw, key);
  }
  return { whisperCppVersion: version, license, model, cli };
}

function asNamedFile(value: unknown, label: string): { file: string; url: string; sha256: string } {
  if (typeof value !== "object" || value === null) {
    throw new Error(`whisper pins ${label} is unreadable`);
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.file !== "string" ||
    typeof record.url !== "string" ||
    !isSha256(record.sha256)
  ) {
    throw new Error(`whisper pins ${label} needs file, url, and sha256`);
  }
  if (!record.url.startsWith("https://")) {
    throw new Error(`whisper pins ${label} url must be https`);
  }
  return { file: record.file, url: record.url, sha256: record.sha256 };
}

function asCliPin(value: unknown, key: string): CliPin {
  if (typeof value !== "object" || value === null) {
    throw new Error(`whisper pins cli ${key} is unreadable`);
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.url !== "string" ||
    !record.url.startsWith("https://") ||
    !isSha256(record.sha256) ||
    (record.format !== "zip" && record.format !== "tar.gz") ||
    typeof record.binary !== "string" ||
    !Array.isArray(record.include) ||
    record.include.some((item) => typeof item !== "string" || item.length === 0)
  ) {
    throw new Error(`whisper pins cli ${key} is incomplete`);
  }
  return {
    url: record.url,
    sha256: record.sha256,
    format: record.format,
    binary: record.binary,
    include: record.include as string[],
  };
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function safeBaseName(name: string): string | undefined {
  if (name.length === 0 || name.includes("\0") || name.includes("..")) return undefined;
  const normalized = name.replaceAll("\\", "/");
  if (normalized.startsWith("/")) return undefined;
  const base = normalized.split("/").filter((part) => part.length > 0).at(-1);
  if (base === undefined || base === "." || base === "..") return undefined;
  return base;
}

function readZip(buffer: Buffer): ArchiveEntry[] {
  const eocd = findEocd(buffer);
  const count = buffer.readUInt16LE(eocd + 8);
  let offset = buffer.readUInt32LE(eocd + 16);
  const entries: ArchiveEntry[] = [];
  let total = 0;
  for (let index = 0; index < count; index += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error("whisper zip central directory is truncated");
    }
    const method = buffer.readUInt16LE(offset + 10);
    const compSize = buffer.readUInt32LE(offset + 20);
    const size = buffer.readUInt32LE(offset + 24);
    const nameLen = buffer.readUInt16LE(offset + 28);
    const extraLen = buffer.readUInt16LE(offset + 30);
    const commentLen = buffer.readUInt16LE(offset + 32);
    const localOff = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString("utf8", offset + 46, offset + 46 + nameLen);
    offset += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith("/")) continue;
    if (compSize === 0xffffffff || size === 0xffffffff) {
      throw new Error("whisper zip64 entries are not supported");
    }
    if (size > MAX_ENTRY_BYTES || compSize > MAX_ENTRY_BYTES) {
      throw new Error(`whisper zip entry is too large: ${name}`);
    }
    const data = inflateZipEntry(buffer, localOff, method, compSize);
    if (data.length !== size && size !== 0) {
      throw new Error(`whisper zip entry size mismatch: ${name}`);
    }
    total += data.length;
    if (total > MAX_ARCHIVE_BYTES) throw new Error("whisper zip expands too far");
    entries.push({ name, data });
  }
  return entries;
}

function findEocd(buffer: Buffer): number {
  const min = Math.max(0, buffer.length - 22 - 0xffff);
  for (let offset = buffer.length - 22; offset >= min; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  throw new Error("whisper zip is missing its central directory");
}

function inflateZipEntry(buffer: Buffer, localOff: number, method: number, compSize: number): Buffer {
  if (localOff + 30 > buffer.length || buffer.readUInt32LE(localOff) !== 0x04034b50) {
    throw new Error("whisper zip local header is missing");
  }
  const nameLen = buffer.readUInt16LE(localOff + 26);
  const extraLen = buffer.readUInt16LE(localOff + 28);
  const dataOff = localOff + 30 + nameLen + extraLen;
  const compressed = buffer.subarray(dataOff, dataOff + compSize);
  if (compressed.length !== compSize) throw new Error("whisper zip entry is truncated");
  if (method === 0) return Buffer.from(compressed);
  if (method === 8) return inflateRawSync(compressed);
  throw new Error(`whisper zip method ${method} is not supported`);
}

function readTar(buffer: Buffer): ArchiveEntry[] {
  const entries: ArchiveEntry[] = [];
  let offset = 0;
  let total = 0;
  while (offset + 512 <= buffer.length) {
    const header = buffer.subarray(offset, offset + 512);
    offset += 512;
    if (header.every((byte) => byte === 0)) break;
    assertTarChecksum(header);
    const name = tarString(header, 0, 100);
    const prefix = tarString(header, 345, 500);
    const full = prefix.length > 0 ? `${prefix}/${name}` : name;
    const size = parseInt(tarString(header, 124, 136).trim(), 8);
    const type = String.fromCharCode(header[156] ?? 0);
    if (!Number.isFinite(size) || size < 0) throw new Error(`whisper tar size is invalid: ${full}`);
    const data = buffer.subarray(offset, offset + size);
    if (data.length !== size) throw new Error(`whisper tar entry is truncated: ${full}`);
    offset += Math.ceil(size / 512) * 512;
    if (type === "5") continue;
    if (type === "L" || type === "x" || type === "g") {
      throw new Error("whisper tar uses an unsupported long-name header");
    }
    if (type === "2") {
      entries.push({ name: full, link: tarString(header, 157, 257) });
      continue;
    }
    if (type !== "0" && type !== "\0") continue;
    if (size > MAX_ENTRY_BYTES) throw new Error(`whisper tar entry is too large: ${full}`);
    total += size;
    if (total > MAX_ARCHIVE_BYTES) throw new Error("whisper tar expands too far");
    entries.push({ name: full, data: Buffer.from(data) });
  }
  return entries;
}

function tarString(header: Buffer, start: number, end: number): string {
  const bytes = header.subarray(start, end);
  const zero = bytes.indexOf(0);
  return bytes.toString("utf8", 0, zero === -1 ? bytes.length : zero);
}

function assertTarChecksum(header: Buffer): void {
  const recorded = parseInt(tarString(header, 148, 156).trim(), 8);
  let sum = 0;
  for (let index = 0; index < 512; index += 1) {
    sum += index >= 148 && index < 156 ? 32 : (header[index] ?? 0);
  }
  if (sum !== recorded) throw new Error("whisper tar checksum does not match");
}

function writeEntries(entries: ArchiveEntry[], dest: string, prefixes: readonly string[]): string[] {
  mkdirSync(dest, { recursive: true });
  const files = new Map<string, Buffer>();
  for (const entry of entries) {
    if (!entryKept(entry.name, prefixes) || entry.data === undefined) continue;
    const base = safeBaseName(entry.name);
    if (base === undefined) continue;
    if (files.has(base)) throw new Error(`whisper archive repeats ${base}`);
    files.set(base, entry.data);
  }
  for (const entry of entries) {
    if (entry.link === undefined || !entryKept(entry.name, prefixes)) continue;
    const base = safeBaseName(entry.name);
    const target = resolveTarLink(entry.link, files, entries, prefixes);
    if (base === undefined || target === undefined || files.has(base)) continue;
    files.set(base, target);
  }
  const written: string[] = [];
  for (const [name, data] of files) {
    writeFileSync(join(dest, name), data);
    written.push(name);
  }
  return written;
}

function resolveTarLink(
  link: string,
  files: Map<string, Buffer>,
  entries: ArchiveEntry[],
  prefixes: readonly string[],
): Buffer | undefined {
  let current = link;
  for (let hop = 0; hop < 8; hop += 1) {
    const base = safeBaseName(current);
    if (base === undefined) return undefined;
    const data = files.get(base);
    if (data !== undefined) return data;
    const next = entries.find((entry) => safeBaseName(entry.name) === base && entryKept(entry.name, prefixes));
    if (next?.data !== undefined) return next.data;
    if (next?.link === undefined) return undefined;
    current = next.link;
  }
  return undefined;
}

function parseArgs(argv: readonly string[]): { platform?: string; arch?: string } {
  const options: { platform?: string; arch?: string } = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--platform" || arg === "--arch") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error(`${arg} needs a value`);
      }
      if (arg === "--platform") options.platform = value;
      else options.arch = value;
      index += 1;
      continue;
    }
    throw new Error(`unknown argument ${arg ?? ""}`);
  }
  return options;
}

const isDirectRun =
  process.argv[1] !== undefined && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isDirectRun) {
  try {
    await fetchWhisper(parseArgs(process.argv.slice(2)));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`fetch-whisper: ${message}\n`);
    process.exitCode = 1;
  }
}
