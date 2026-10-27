import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    /**
     * Every case here builds a real SQLite file and replays migrations, so the
     * cost is disk latency rather than CPU: on a Windows CI runner the slowest
     * case (`database.test.ts` upgrades v13 connector rows) replays 13
     * migrations and has exceeded the 5 s default (observed on the push run of
     * 86a4748). 20 s keeps a genuine hang failing while leaving room for I/O
     * jitter; it does not change any assertion.
     */
    testTimeout: 20_000,
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

