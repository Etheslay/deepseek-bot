import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateRawSync, gzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { entryKept, extractTarGz, extractZip } from "../scripts/fetch-whisper.mts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function dest(): string {
  const root = mkdtempSync(join(tmpdir(), "dsb-fetch-whisper-"));
  roots.push(root);
  return root;
}

describe("entryKept", () => {
  const prefixes = ["whisper-cli.exe", "whisper.dll", "ggml-cpu-"];

  it("keeps the cli and cpu backends and drops the rest of the release zip", () => {
    expect(entryKept("Release/whisper-cli.exe", prefixes)).toBe(true);
    expect(entryKept("Release/ggml-cpu-x64.dll", prefixes)).toBe(true);
    expect(entryKept("Release/whisper-server.exe", prefixes)).toBe(false);
    expect(entryKept("Release/SDL2.dll", prefixes)).toBe(false);
  });

  it("rejects names that leave the bundle directory", () => {
    expect(entryKept("../whisper-cli.exe", prefixes)).toBe(false);
    expect(entryKept("/tmp/whisper-cli.exe", prefixes)).toBe(false);
    expect(entryKept("Release\\whisper-cli.exe", prefixes)).toBe(true);
  });
});

describe("extractZip", () => {
  it("inflates only the named files and flattens directories", () => {
    const root = dest();
    const cli = Buffer.from("cli-bytes");
    const server = Buffer.from("do-not-ship");
    const zip = makeZip([
      { name: "Release/whisper-cli.exe", data: cli, method: 8 },
      { name: "Release/whisper-server.exe", data: server, method: 0 },
      { name: "../outside.exe", data: Buffer.from("nope"), method: 0 },
    ]);
    const written = extractZip(zip, root, ["whisper-cli.exe"]);
    expect(written).toEqual(["whisper-cli.exe"]);
    expect(readFileSync(join(root, "whisper-cli.exe"))).toEqual(cli);
    expect(() => readFileSync(join(root, "whisper-server.exe"))).toThrow();
    expect(() => readFileSync(join(root, "..", "outside.exe"))).toThrow();
  });
});

describe("extractTarGz", () => {
  it("materializes a kept symlink as a copy of the library", () => {
    const root = dest();
    const library = Buffer.from("lib-bytes");
    const tar = makeTar([
      { name: "whisper-bin/libwhisper.so.1.9.2", data: library },
      { name: "whisper-bin/libwhisper.so.1", link: "libwhisper.so.1.9.2" },
      { name: "whisper-bin/whisper-cli", data: Buffer.from("cli") },
      { name: "whisper-bin/whisper-server", data: Buffer.from("server") },
    ]);
    const written = extractTarGz(gzipSync(tar), root, ["whisper-cli", "libwhisper.so"]).sort();
    expect(written).toEqual(["libwhisper.so.1", "libwhisper.so.1.9.2", "whisper-cli"]);
    expect(readFileSync(join(root, "libwhisper.so.1"))).toEqual(library);
    expect(readFileSync(join(root, "whisper-cli"))).toEqual(Buffer.from("cli"));
  });
});

function makeZip(entries: { name: string; data: Buffer; method: 0 | 8 }[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const payload = entry.method === 0 ? entry.data : deflateRawSync(entry.data);
    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(entry.method, 8);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    name.copy(local, 30);
    locals.push(local, payload);
    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(entry.method, 10);
    central.writeUInt32LE(payload.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);
    centrals.push(central);
    offset += local.length + payload.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, eocd]);
}

function makeTar(entries: { name: string; data?: Buffer; link?: string }[]): Buffer {
  const chunks: Buffer[] = [];
  for (const entry of entries) {
    const header = Buffer.alloc(512);
    header.write(entry.name);
    header.write("0000644\0", 100);
    header.write("0000000\0", 108);
    header.write("0000000\0", 116);
    const payload = entry.data ?? Buffer.alloc(0);
    header.write(`${payload.length.toString(8).padStart(11, "0")}\0`, 124);
    header.write("00000000000\0", 136);
    header[156] = entry.link === undefined ? "0".charCodeAt(0) : "2".charCodeAt(0);
    if (entry.link !== undefined) header.write(entry.link, 157);
    header.write("ustar\0", 257);
    header.write("        ", 148);
    let sum = 0;
    for (const byte of header) sum += byte;
    header.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148);
    chunks.push(header, payload, Buffer.alloc((512 - (payload.length % 512)) % 512));
  }
  chunks.push(Buffer.alloc(1024));
  return Buffer.concat(chunks);
}
