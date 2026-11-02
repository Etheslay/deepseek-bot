import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "**/coverage/**",
      "**/out/**",
      "**/release/**",
      "handoff/**",
      ".ui-profile*/**",
      ".tmp*/**",
      ".baoyu-skills/**",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx,mts,js,mjs,cjs}"],
    languageOptions: {
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // Node test scaffolding scripts (e.g. the fake harness and fake host
    // runtimes) are plain ESM outside TypeScript, so the Node globals must
    // be declared here.
    files: ["**/src/testing/*.mjs", "**/tests/**/fixtures/*.mjs"],
    languageOptions: {
      globals: {
        console: "readonly",
        process: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
      },
    },
  },
  {
    files: ["apps/desktop/scripts/**/*.mts"],
    languageOptions: {
      globals: {
        AbortSignal: "readonly",
        Buffer: "readonly",
        console: "readonly",
        fetch: "readonly",
        process: "readonly",
        URL: "readonly",
      },
    },
  },
  {
    files: ["packages/exec-daemon/assets/**/*.cjs", "packages/exec-daemon/scripts/**/*.mjs"],
    languageOptions: {
      globals: {
        Buffer: "readonly",
        URL: "readonly",
        WebAssembly: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
        console: "readonly",
        globalThis: "readonly",
        process: "readonly",
        require: "readonly",
      },
    },
  },
  {
    files: ["packages/exec-daemon/assets/**/*.cjs"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
);
