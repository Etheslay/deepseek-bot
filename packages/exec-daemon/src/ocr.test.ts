import { execFile } from "node:child_process";
import { lstat, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createScreenBackend } from "./backend.js";
import { MAX_OCR_TEXT_CHARS, MAX_PNG_BYTES } from "./limits.js";
import { resolveResources, type OcrEngine } from "./ocr.js";

const exec = promisify(execFile);
const packageRoot = fileURLToPath(new URL("..", import.meta.url));

const scratch: string[] = [];
const kept: string[] = [];
const ONE_PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

afterEach(async () => {
  await Promise.all(
    scratch.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

afterAll(async () => {
  await Promise.all(
    kept.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("offline OCR resources", () => {
  let built = "";

  beforeAll(async () => {
    built = await buildResources(true);
  }, 60_000);

  it("copies pinned worker, wasm, languages, and licenses outside node_modules", async () => {
    const lang = path.join(built, "lang", "eng.traineddata.gz");
    const worker = await readFile(path.join(built, "worker.cjs"), "utf8");
    const manifest = JSON.parse(await readFile(path.join(built, "manifest.json"), "utf8")) as {
      pins: Record<string, string>;
    };
    expect(manifest.pins["tesseract.js"]).toBe("7.0.0");
    expect(manifest.pins["tesseract.js-core"]).toBe("7.0.0");
    expect(await readFile(path.join(built, "lang", "chi_sim.traineddata.gz"))).toBeInstanceOf(
      Buffer,
    );
    expect((await realpath(lang)).includes(`${path.sep}node_modules${path.sep}`)).toBe(false);
    expect(worker).toContain("offline OCR refuses network");
    expect(worker).not.toContain("cdn.jsdelivr.net");
    expect(worker).not.toContain("tesseract.js-core/tesseract-core");
    const sourceStat = await lstat(lang);
    expect(sourceStat.isSymbolicLink()).toBe(false);
  });

  it("fails closed when language data is missing and does not start the engine", async () => {
    const incomplete = await buildResources();
    await rm(path.join(incomplete, "lang", "chi_sim.traineddata.gz"));
    let calls = 0;
    const backend = createScreenBackend({
      resourcesDirectory: incomplete,
      ocrEngine: {
        async recognize() {
          calls += 1;
          return "unused";
        },
      },
    });
    const image = await writeImage(ONE_PIXEL);
    await expect(backend.recognize(image, new AbortController().signal)).rejects.toMatchObject({
      code: "RUNTIME_UNAVAILABLE",
      reason: "resources",
    });
    expect(calls).toBe(0);
  });

  it("rejects network paths, oversized images, and text over 64 KiB", async () => {
    const image = await writeImage(ONE_PIXEL);
    const engine: OcrEngine = {
      async recognize() {
        return `${"字".repeat(MAX_OCR_TEXT_CHARS)}\n`;
      },
    };
    const backend = createScreenBackend({ resourcesDirectory: built, ocrEngine: engine });
    await expect(
      backend.recognize("https://example.invalid/a.png", new AbortController().signal),
    ).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    await expect(backend.recognize(image, new AbortController().signal)).rejects.toMatchObject({
      code: "INVALID_INPUT",
      reason: "size",
    });
    const huge = await writeImage(Buffer.concat([ONE_PIXEL, Buffer.alloc(MAX_PNG_BYTES)]));
    await expect(backend.recognize(huge, new AbortController().signal)).rejects.toMatchObject({
      reason: "size",
    });
    const linked = await linkImage();
    await expect(backend.recognize(linked, new AbortController().signal)).rejects.toMatchObject({
      code: "UNAUTHORIZED_PATH",
    });
  });

  it("reads a synthetic bilingual image with the bundled worker and no network", async () => {
    const resources = await resolveResources(built);
    expect(resources.workerPath.startsWith(resources.root)).toBe(true);
    expect(resources.langPath.startsWith(resources.root)).toBe(true);
    const backend = createScreenBackend({ resourcesDirectory: built, ocrTimeoutMs: 90_000 });
    const fixture = fileURLToPath(new URL("../fixtures/synthetic-bilingual.png", import.meta.url));
    const text = await backend.recognize(fixture, new AbortController().signal);
    expect(text.toUpperCase()).toContain("HELLO");
    expect(text).toContain("测试");
    expect(text.includes("\0")).toBe(false);
  }, 120_000);

  it("recognizes offline when resources are shipped inside an ESM application", async () => {
    const resourcesDirectory = await buildResources();
    await writeFile(
      path.join(resourcesDirectory, "..", "package.json"),
      JSON.stringify({ type: "module" }),
    );
    const backend = createScreenBackend({ resourcesDirectory });
    try {
      const fixture = fileURLToPath(
        new URL("../fixtures/synthetic-bilingual.png", import.meta.url),
      );
      const text = await backend.recognize(fixture, new AbortController().signal);
      expect(text.toUpperCase()).toContain("HELLO");
      expect(text).toContain("测试");
    } finally {
      backend.close();
    }
  }, 30_000);

  it("runs the bundled backend without looking for source layout files", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "dsb-bundled-ocr-"));
    scratch.push(directory);
    const bundle = path.join(directory, "backend.mjs");
    await build({
      entryPoints: [path.join(packageRoot, "src/index.ts")],
      outfile: bundle,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node24",
      logLevel: "silent",
    });
    const fixture = fileURLToPath(new URL("../fixtures/synthetic-bilingual.png", import.meta.url));
    const program = `import {createScreenBackend} from ${JSON.stringify(pathToFileURL(bundle).href)}; const backend=createScreenBackend({resourcesDirectory:process.argv[1]}); try {console.log(await backend.recognize(process.argv[2],new AbortController().signal));} finally {backend.close();}`;
    const { stdout } = await exec(process.execPath, [
      "--input-type=module",
      "-e",
      program,
      built,
      fixture,
    ]);
    expect(stdout.toUpperCase()).toContain("HELLO");
    expect(stdout).toContain("测试");
  }, 30_000);
});

async function buildResources(retain = false): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "dsb-screen-ocr-"));
  (retain ? kept : scratch).push(directory);
  const built = path.join(directory, "ocr");
  await exec(process.execPath, ["scripts/build-resources.mjs", built], { cwd: packageRoot });
  return built;
}

async function writeImage(bytes: Buffer): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "dsb-screen-img-"));
  scratch.push(directory);
  const file = path.join(directory, "page.png");
  await writeFile(file, bytes);
  return file;
}

async function linkImage(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "dsb-screen-link-"));
  scratch.push(directory);
  const target = path.join(directory, "target.png");
  const link = path.join(directory, "link.png");
  await writeFile(target, ONE_PIXEL);
  // Windows file symlinks require Developer Mode/admin rights. A junction at
  // the same input path exercises the same link rejection without skipping it.
  await symlink(
    process.platform === "win32" ? directory : target,
    link,
    process.platform === "win32" ? "junction" : "file",
  );
  return link;
}
