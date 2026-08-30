import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: ["tests/integration/qa-scenario-factory.test.ts"],
    include: ["tests/integration/**/*.test.ts"],
    fileParallelism: false,
    setupFiles: ["tests/helpers/integration-test-setup.ts"],
    testTimeout: 15_000,
  },
});
