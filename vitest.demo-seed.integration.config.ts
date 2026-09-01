import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/integration/demo-seed-runtime.test.ts"],
    fileParallelism: false,
    setupFiles: ["tests/helpers/integration-test-setup.ts"],
    testTimeout: 30_000,
  },
});
