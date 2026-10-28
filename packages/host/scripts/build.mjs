/**
 * Bundle the Host into a single Node ESM file.
 *
 * The workspace packages ship TypeScript sources (`exports: ./src/index.ts`),
 * so a plain `tsc` build leaves `import "@deepseek-bot/storage"` pointing at
 * .ts files that Node cannot load. Bundling keeps the Host runnable as a
 * standalone child process (the desktop main spawns it with `node`).
 */
import { build } from "esbuild";
import process from "node:process";
import { URL, fileURLToPath, pathToFileURL } from "node:url";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { buildOcrResources } from "../../exec-daemon/scripts/build-resources.mjs";

const entry = fileURLToPath(new URL("../src/main.ts", import.meta.url));
const distribution =
  process.argv[2] === undefined
    ? fileURLToPath(new URL("../dist/", import.meta.url))
    : resolve(process.argv[2]);
const outfile = join(distribution, "main.js");
const bridgeRoot = new URL("../../harness-bridge/", import.meta.url);
const bridgeOut = pathToFileURL(join(distribution, "harness-bridge") + sep);

// Desktop extraResources copies this complete distribution outside the asar.
await buildOcrResources(join(distribution, "screen-assets", "ocr"));
await cp(
  new URL("../../exec-daemon/assets/win32-capture.ps1", import.meta.url),
  join(distribution, "screen-assets", "win32-capture.ps1"),
);
await cp(
  new URL("../../exec-daemon/assets/win32-input.ps1", import.meta.url),
  join(distribution, "screen-assets", "win32-input.ps1"),
);
await writeFile(join(distribution, "package.json"), JSON.stringify({ type: "module" }));

// Ship the app-owned plugin as a dependency-free module beside the Host.
// Offline profile preparation copies this package; users never run pnpm.
await build({
  entryPoints: [fileURLToPath(new URL("src/index.ts", bridgeRoot))],
  outfile: fileURLToPath(new URL("dist/index.js", bridgeOut)),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  logLevel: "info",
});
await mkdir(bridgeOut, { recursive: true });
const bridgeManifest = JSON.parse(await readFile(new URL("package.json", bridgeRoot), "utf8"));
await writeFile(
  new URL("package.json", bridgeOut),
  JSON.stringify(
    {
      name: bridgeManifest.name,
      version: bridgeManifest.version,
      type: "module",
      main: "./dist/index.js",
      exports: { ".": "./dist/index.js" },
    },
    null,
    2,
  ),
);

await build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  sourcemap: false,
  logLevel: "info",
  // Native/binary dependencies stay external; everything else is inlined.
  external: ["@deepseek-ai/dsh", "node-pty", "better-sqlite3"],
  banner: {
    js: 'import { createRequire as __dsbCreateRequire } from "node:module"; const require = __dsbCreateRequire(import.meta.url);',
  },
});
