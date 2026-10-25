import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    testTimeout: 20_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/testing/**", "src/index.ts"],
      thresholds: {
        // TESTING.md §3: ≥80% lines/statements/functions for runtime modules.
        lines: 80,
        functions: 80,
        statements: 80,
        branches: 80,
      },
    },
  },
});
