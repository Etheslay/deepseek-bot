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
        // TESTING.md §3: ≥80% lines; state-machine branch bars are covered by
        // @deepseek-bot/contracts (100%). The remaining ~15% uncovered
        // branches here are defensive guards for states a single synchronous
        // writer cannot reach — see docs/reports/D04-report.md §5.
        lines: 80,
        functions: 80,
        statements: 80,
        branches: 84,
      },
    },
  },
});

