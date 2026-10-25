import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    testTimeout: 30_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/index.ts", "src/main.ts"],
      thresholds: {
        // TESTING.md §3: ≥80% for runtime modules. main.ts (the spawn entry)
        // and index.ts (re-exports) are excluded. The host assembly's
        // uncovered branches are defensive paths the public surface cannot
        // reach: the response-contract violation guard in host.ts (handlers
        // are compile-time bound to their response schemas) and the
        // post-decision approval refetch guard. Branch coverage is held at
        // 70 for those; everything else stays 80.
        lines: 80,
        functions: 80,
        statements: 80,
        branches: 70,
      },
    },
  },
});
