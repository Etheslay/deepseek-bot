import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  readWhisperBundleDirectory,
  resolveWhisperBundle,
  whisperBundleCandidates,
} from "./whisper-bundle.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempDir(): string {
  const root = mkdtempSync(join(tmpdir(), "dsb-whisper-bundle-"));
  roots.push(root);
  return root;
}

function stamp(root: string, body: unknown): void {
  writeFileSync(join(root, "bundle.json"), JSON.stringify(body));
}

describe("readWhisperBundleDirectory", () => {
  it("returns the two local files named by the stamp", () => {
    const root = tempDir();
    writeFileSync(join(root, "whisper-cli"), "bin");
    writeFileSync(join(root, "ggml-tiny-q5_1.bin"), "model");
    stamp(root, { binary: "whisper-cli", model: "ggml-tiny-q5_1.bin" });
    expect(readWhisperBundleDirectory(root)).toEqual({
      whisperBin: join(root, "whisper-cli"),
      whisperModel: join(root, "ggml-tiny-q5_1.bin"),
    });
  });

  it("ignores a missing directory, a broken stamp, and a file that is not there", () => {
    const root = tempDir();
    expect(readWhisperBundleDirectory(join(root, "missing"))).toBeUndefined();
    writeFileSync(join(root, "bundle.json"), "{");
    expect(readWhisperBundleDirectory(root)).toBeUndefined();
    stamp(root, { binary: "whisper-cli", model: "ggml-tiny-q5_1.bin" });
    expect(readWhisperBundleDirectory(root)).toBeUndefined();
  });

  it("rejects a stamp that points outside the bundle directory", () => {
    const root = tempDir();
    writeFileSync(join(root, "whisper-cli"), "bin");
    stamp(root, { binary: "../whisper-cli", model: "ggml-tiny-q5_1.bin" });
    expect(readWhisperBundleDirectory(root)).toBeUndefined();
    stamp(root, { binary: "whisper-cli", model: "C:\\models\\m.bin" });
    expect(readWhisperBundleDirectory(root)).toBeUndefined();
  });

  it("ignores a stamp that is too large to be a path list", () => {
    const root = tempDir();
    writeFileSync(join(root, "bundle.json"), "x".repeat(5_000));
    expect(readWhisperBundleDirectory(root)).toBeUndefined();
  });
});

describe("resolveWhisperBundle", () => {
  it("uses the first directory that has both files", () => {
    const empty = tempDir();
    const ready = tempDir();
    writeFileSync(join(ready, "whisper-cli.exe"), "bin");
    writeFileSync(join(ready, "model.bin"), "model");
    stamp(ready, { binary: "whisper-cli.exe", model: "model.bin" });
    expect(resolveWhisperBundle([empty, ready])).toEqual({
      whisperBin: join(ready, "whisper-cli.exe"),
      whisperModel: join(ready, "model.bin"),
    });
    expect(resolveWhisperBundle([])).toEqual({});
  });
});

describe("whisperBundleCandidates", () => {
  it("checks the packaged sibling and the checkout dist", () => {
    const moduleUrl = pathToFileURL(join("repo", "packages", "host", "dist", "main.js")).href;
    const candidates = whisperBundleCandidates(moduleUrl);
    expect(candidates[0]?.endsWith(join("host", "whisper"))).toBe(true);
    expect(candidates[1]?.endsWith(join("apps", "desktop", "resources", "whisper", "dist"))).toBe(true);
  });
});
