import { resolve } from "node:path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";

const cjsOutput = {
  format: "cjs",
  entryFileNames: "[name].cjs",
  chunkFileNames: "[name]-[hash].cjs",
} as const;

export default defineConfig({
  main: {
    // Workspace packages ship TypeScript sources (packages/*/src/index.ts), so
    // they cannot be `require`d at runtime. Anything the main process imports
    // from the workspace must be bundled into out/main/index.cjs.
    plugins: [externalizeDepsPlugin({ exclude: ["@deepseek-bot/contracts"] })],
    build: {
      outDir: "out/main",
      rollupOptions: {
        input: {
          index: resolve(__dirname, "src/main/index.ts"),
        },
        output: cjsOutput,
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: "out/preload",
      rollupOptions: {
        input: {
          index: resolve(__dirname, "src/preload/index.ts"),
        },
        output: cjsOutput,
      },
    },
  },
  renderer: {
    root: resolve(__dirname, "src/renderer"),
    build: {
      outDir: resolve(__dirname, "out/renderer"),
      rollupOptions: {
        input: {
          index: resolve(__dirname, "src/renderer/index.html"),
        },
      },
    },
    plugins: [react()],
  },
});

