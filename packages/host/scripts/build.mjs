/**
 * Bundle the Host into a single Node ESM file.
 *
 * The workspace packages ship TypeScript sources (`exports: ./src/index.ts`),
 * so a plain `tsc` build leaves `import "@deepseek-bot/storage"` pointing at
 * .ts files that Node cannot load. Bundling keeps the Host runnable as a
 * standalone child process (the desktop main spawns it with `node`).
 */
import { build } from "esbuild";
import { URL, fileURLToPath } from "node:url";

const entry = fileURLToPath(new URL("../src/main.ts", import.meta.url));
const outfile = fileURLToPath(new URL("../dist/main.js", import.meta.url));

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

