import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/contract/**/*.test.ts"],
    testTimeout: 10_000,
  },
});
