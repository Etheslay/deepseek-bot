import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createScreenBackend, type ScreenBackendOptions } from "./backend.js";
import { MAX_PNG_BYTES } from "./limits.js";
import type { HelperRequest, HelperRunner, WindowIdentity } from "./windows.js";

const identity: WindowIdentity = { hwnd: "100", pid: 20, processStartTime: "300" };
const directories: string[] = [];
const ONE_PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("screen backend", () => {
  it("rejects identities and paths before starting a helper", async () => {
    const { directory, resources } = await layout();
    let calls = 0;
    const backend = backendWith(resources, {
      async run() {
        calls += 1;
        return '{"ok":true,"windows":[]}';
      },
    });
    const signal = new AbortController().signal;
    await expect(
      backend.capture({ hwnd: "1;calc", pid: 1, processStartTime: "1" }, directory, signal),
    ).rejects.toMatchObject({
      code: "INVALID_INPUT",
      reason: "identity",
    });
    await expect(
      backend.capture({ hwnd: "10", pid: 0, processStartTime: "10" }, directory, signal),
    ).rejects.toMatchObject({ reason: "identity" });
    await expect(
      backend.capture({ hwnd: "10", pid: 1.5, processStartTime: "10" }, directory, signal),
    ).rejects.toMatchObject({ reason: "identity" });
    await expect(backend.capture(identity, "relative/out", signal)).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    expect(calls).toBe(0);
  });

  it("refuses a pre-existing capture link without calling the helper", async () => {
    const { directory, resources } = await layout();
    const outside = path.join(directory, "outside.png");
    await writeFile(outside, ONE_PIXEL);
    const output = path.join(directory, "out");
    await mkdir(output);
    await captureLink(outside, path.join(output, "capture.png"));
    let calls = 0;
    const backend = backendWith(resources, {
      async run() {
        calls += 1;
        return "{}";
      },
    });
    await expect(
      backend.capture(identity, output, new AbortController().signal),
    ).rejects.toMatchObject({
      code: "UNAUTHORIZED_PATH",
    });
    expect(calls).toBe(0);
  });

  it("returns a controlled png and deletes rejected captures", async () => {
    const { directory, resources } = await layout();
    const output = path.join(directory, "out");
    await mkdir(output);
    const backend = backendWith(resources, {
      async run() {
        await writeFile(path.join(output, "capture.png"), ONE_PIXEL);
        return JSON.stringify({ ok: true, width: 1, height: 1 });
      },
    });
    const captured = await backend.capture(identity, output, new AbortController().signal);
    expect(captured).toMatchObject({ width: 1, height: 1, byteLength: ONE_PIXEL.length });
    // realpath folds a Windows 8.3 temp alias and its long name onto one path.
    expect(await realpath(captured.pngPath)).toBe(await realpath(path.join(output, "capture.png")));
    expect(await readFile(captured.pngPath)).toEqual(ONE_PIXEL);

    const notPng = backendWith(resources, {
      async run() {
        await writeFile(path.join(output, "capture.png"), Buffer.from("not-a-png"));
        return JSON.stringify({ ok: true, width: 1, height: 1 });
      },
    });
    await expect(
      notPng.capture(identity, output, new AbortController().signal),
    ).rejects.toMatchObject({
      code: "INVALID_INPUT",
      reason: "input",
    });

    const oversized = backendWith(resources, {
      async run() {
        await writeFile(
          path.join(output, "capture.png"),
          Buffer.concat([ONE_PIXEL, Buffer.alloc(MAX_PNG_BYTES)]),
        );
        return JSON.stringify({ ok: true, width: 1, height: 1 });
      },
    });
    await expect(
      oversized.capture(identity, output, new AbortController().signal),
    ).rejects.toMatchObject({
      code: "INVALID_INPUT",
      reason: "size",
    });
    await expect(readFile(path.join(output, "capture.png"))).rejects.toThrow();
  });

  it("rejects pixel limits and a capture that escapes the output directory", async () => {
    const { directory, resources } = await layout();
    const output = path.join(directory, "out");
    await mkdir(output);
    const outside = path.join(directory, "outside.png");
    await writeFile(outside, ONE_PIXEL);
    const wide = pngHeader(5_000, 4_000);
    const pixels = backendWith(resources, {
      async run() {
        await writeFile(path.join(output, "capture.png"), wide);
        return JSON.stringify({ ok: true, width: 5_000, height: 4_000 });
      },
    });
    await expect(
      pixels.capture(identity, output, new AbortController().signal),
    ).rejects.toMatchObject({ reason: "size" });

    const escaped = backendWith(resources, {
      async run() {
        await captureLink(outside, path.join(output, "capture.png"));
        return JSON.stringify({ ok: true, width: 1, height: 1 });
      },
    });
    await expect(
      escaped.capture(identity, output, new AbortController().signal),
    ).rejects.toMatchObject({
      code: "UNAUTHORIZED_PATH",
    });
  });

  it("cancels an in-flight capture and times out a helper that does not finish", async () => {
    const { resources } = await layout();
    const output = await mkdtemp(path.join(tmpdir(), "dsb-screen-out-"));
    directories.push(output);
    const controller = new AbortController();
    controller.abort();
    await expect(
      backendWith(resources, hangingHelper()).listWindows(controller.signal),
    ).rejects.toMatchObject({
      code: "CANCELLED",
    });
    const live = new AbortController();
    const cancelling = backendWith(resources, hangingHelper());
    const pending = cancelling.capture(identity, output, live.signal);
    live.abort();
    await expect(pending).rejects.toMatchObject({ code: "CANCELLED" });

    const timingOut = createScreenBackend({
      resourcesDirectory: resources,
      captureTimeoutMs: 40,
      helperRunner: hangingHelper(),
    });
    await expect(
      timingOut.capture(identity, output, new AbortController().signal),
    ).rejects.toMatchObject({
      code: "TOOL_TIMEOUT",
    });
  });

  it("close cancels in-flight work and rejects later calls", async () => {
    const { resources } = await layout();
    const output = await mkdtemp(path.join(tmpdir(), "dsb-screen-out-"));
    directories.push(output);
    let release: (() => void) | undefined;
    const backend = backendWith(resources, {
      run(_request, signal) {
        return new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
          release = () => reject(new Error("still running"));
        });
      },
    });
    const pending = backend.capture(identity, output, new AbortController().signal);
    await waitUntil(() => release !== undefined);
    backend.close();
    backend.close();
    await expect(pending).rejects.toMatchObject({ code: "CANCELLED" });
    await expect(backend.listWindows(new AbortController().signal)).rejects.toMatchObject({
      code: "RUNTIME_UNAVAILABLE",
    });
  });

  it("maps a minimized helper result and an aborted list", async () => {
    const { resources } = await layout();
    const backend = backendWith(resources, {
      async run() {
        return JSON.stringify({ ok: false, code: "MINIMIZED", message: "Notepad" });
      },
    });
    const output = await mkdtemp(path.join(tmpdir(), "dsb-screen-out-"));
    directories.push(output);
    await expect(
      backend.capture(identity, output, new AbortController().signal),
    ).rejects.toMatchObject({
      code: "INVALID_INPUT",
      reason: "minimized",
    });
    const controller = new AbortController();
    controller.abort();
    await expect(backend.listWindows(controller.signal)).rejects.toMatchObject({
      code: "CANCELLED",
    });
  });
});

function backendWith(
  resourcesDirectory: string,
  helperRunner: HelperRunner,
  extra: Partial<ScreenBackendOptions> = {},
) {
  return createScreenBackend({ resourcesDirectory, helperRunner, ...extra });
}

async function captureLink(outsideFile: string, link: string): Promise<void> {
  if (process.platform === "win32") {
    // Junctions exercise the same lstat reparse-point rejection without requiring
    // Windows Developer Mode or the privilege needed to create file symlinks.
    const outsideDirectory = `${outsideFile}.directory`;
    await mkdir(outsideDirectory);
    await symlink(outsideDirectory, link, "junction");
  } else {
    await symlink(outsideFile, link);
  }
  expect((await lstat(link)).isSymbolicLink()).toBe(true);
}

function hangingHelper(): HelperRunner {
  return {
    run(_request: HelperRequest, signal: AbortSignal) {
      return new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("aborted")));
      });
    },
  };
}

async function layout(): Promise<{ directory: string; resources: string }> {
  const directory = await mkdtemp(path.join(tmpdir(), "dsb-screen-"));
  directories.push(directory);
  const resources = path.join(directory, "resources");
  await mkdir(resources);
  return { directory, resources };
}

function pngHeader(width: number, height: number): Buffer {
  const bytes = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes);
  bytes.writeUInt32BE(13, 8);
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

async function waitUntil(ready: () => boolean): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (!ready()) {
    if (Date.now() > deadline) throw new Error("helper did not start");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
