import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    testTimeout: 30_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/index.ts", "src/testing/**"],
      thresholds: {
        // TESTING.md asks for 80% line coverage. Branch coverage stays at 75
        // because the Windows process-kill path and path-case folding do not
        // run on the Linux test host.
        lines: 80,
        functions: 80,
        statements: 80,
        branches: 75,
      },
    },
  },
});
