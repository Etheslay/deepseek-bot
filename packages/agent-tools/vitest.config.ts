import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/index.ts"],
      thresholds: {
        // TESTING.md §3: ≥80% for runtime modules; the gateway is the only
        // sanctioned side-effect path (AGENT_PLATFORM §2).
        lines: 80,
        functions: 80,
        statements: 80,
        branches: 70,
      },
    },
  },
});
