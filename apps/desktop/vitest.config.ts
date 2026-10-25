import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const contractsFixtures = fileURLToPath(
  new URL("../../packages/contracts/fixtures", import.meta.url),
);

export default defineConfig({
  resolve: {
    alias: {
      "@deepseek-bot/contracts/fixtures": contractsFixtures,
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
