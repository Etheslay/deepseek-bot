import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts"],
      thresholds: {
        // TESTING.md §3: ≥80% for runtime modules; the bridge is the
        // enforcement path, so its branches are held to the same bar.
        lines: 80,
        functions: 80,
        statements: 80,
        branches: 80,
      },
    },
  },
});
