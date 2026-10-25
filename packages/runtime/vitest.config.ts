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
        // TESTING.md §3: ≥80% lines/statements/functions for runtime modules.
        // The remaining uncovered branches are defensive guards for states a
        // single-writer engine cannot reach (e.g. a descendant of a failed
        // node that already succeeded) — see docs/reports/D06-report.md §5.
        lines: 80,
        functions: 80,
        statements: 80,
        branches: 80,
      },
    },
  },
});
