/**
 * Copy the pinned offline OCR worker, WASM, language data, and licenses.
 * Runtime loads this directory only. It does not read node_modules or a CDN.
 */
import { build } from "esbuild";
import { createRequire } from "node:module";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(path.join(packageRoot, "package.json"));
const layout = JSON.parse(
  await readFile(new URL("../src/ocr-layout.json", import.meta.url), "utf8"),
);

export async function buildOcrResources(outDir) {
  const resolved = {};
  for (const [name, version] of Object.entries(layout.pins)) {
    const manifestPath = require.resolve(`${name}/package.json`);
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    if (manifest.version !== version) {
      throw new Error(`${name} ${version} is pinned, resolved ${manifest.version}`);
    }
    resolved[name] = path.dirname(manifestPath);
  }

  await rm(outDir, { recursive: true, force: true });
  await mkdir(path.join(outDir, "core"), { recursive: true });
  await mkdir(path.join(outDir, "lang"), { recursive: true });
  await mkdir(path.join(outDir, "licenses"), { recursive: true });
  // The upstream core .js files use CommonJS, including inside an ESM Host.
  await writeFile(path.join(outDir, "package.json"), JSON.stringify({ type: "commonjs" }));

  const tesseractRequire = createRequire(path.join(resolved["tesseract.js"], "package.json"));
  const wasmDetect = tesseractRequire.resolve("wasm-feature-detect");
  await build({
    entryPoints: [path.join(packageRoot, "assets", "ocr-worker.cjs")],
    outfile: path.join(outDir, "worker.cjs"),
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node24",
    legalComments: "none",
    logLevel: "silent",
    alias: { "wasm-feature-detect": wasmDetect },
    plugins: [forbidRemoteLanguageData()],
  });

  for (const file of layout.coreFiles) {
    await cp(path.join(resolved["tesseract.js-core"], file), path.join(outDir, "core", file), {
      dereference: true,
    });
  }
  await cp(
    path.join(resolved["@tesseract.js-data/eng"], layout.langVariant, "eng.traineddata.gz"),
    path.join(outDir, "lang", "eng.traineddata.gz"),
    { dereference: true },
  );
  await cp(
    path.join(resolved["@tesseract.js-data/chi_sim"], layout.langVariant, "chi_sim.traineddata.gz"),
    path.join(outDir, "lang", "chi_sim.traineddata.gz"),
    { dereference: true },
  );
  await cp(
    path.join(resolved["tesseract.js"], "LICENSE.md"),
    path.join(outDir, "licenses", "tesseract.js.LICENSE.md"),
    {
      dereference: true,
    },
  );
  await cp(
    path.join(resolved["tesseract.js-core"], "LICENSE"),
    path.join(outDir, "licenses", "tesseract.js-core.LICENSE"),
    {
      dereference: true,
    },
  );
  const dataNotice = {
    packages: ["@tesseract.js-data/eng", "@tesseract.js-data/chi_sim"],
    version: layout.pins["@tesseract.js-data/eng"],
    license: "MIT",
    variant: layout.langVariant,
    source: "https://github.com/naptha/tessdata",
    note: "The published 1.0.0 packages declare MIT in package.json and do not ship a LICENSE file.",
  };
  await writeFile(
    path.join(outDir, "licenses", "tesseract-data.json"),
    `${JSON.stringify(dataNotice, null, 2)}\n`,
  );
  const manifest = {
    pins: layout.pins,
    langVariant: layout.langVariant,
    files: [
      "worker.cjs",
      ...layout.coreFiles.map((file) => `core/${file}`),
      ...layout.langFiles.map((file) => `lang/${file}`),
      ...layout.licenseFiles,
    ],
  };
  await writeFile(path.join(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

function forbidRemoteLanguageData() {
  return {
    name: "forbid-remote-language-data",
    setup(bundle) {
      bundle.onLoad({ filter: /worker-script[/\\]index\.js$/ }, async (args) => {
        const source = await readFile(args.path, "utf8");
        return {
          contents: source.replaceAll("https://cdn.jsdelivr.net", "offline-ocr-blocked"),
          loader: "js",
        };
      });
    },
  };
}

const isMain =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const outDir = path.resolve(process.argv[2] ?? path.join(packageRoot, "dist", "ocr"));
  await buildOcrResources(outDir);
}
