import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/integration/qa-scenario-factory.test.ts"],
    fileParallelism: false,
    testTimeout: 120_000,
  },
});
