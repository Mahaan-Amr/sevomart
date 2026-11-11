import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/runtime",
  outputDir: "output/playwright-payment-runtime-results",
  use: {
    browserName: "chromium",
    ...(process.env.CI ? {} : { channel: "chrome" }),
    locale: "fa-IR",
  },
  projects: [
    { name: "development", use: { baseURL: "http://127.0.0.1:3510" } },
    { name: "production", use: { baseURL: "http://127.0.0.1:3511" } },
  ],
  webServer: [
    {
      command: "pnpm --filter @sevo/web start --port 3510",
      env: { NODE_ENV: "production", SEVO_RUNTIME_ENV: "development" },
      url: "http://127.0.0.1:3510/checkout/delivery",
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: "pnpm --filter @sevo/web start --port 3511",
      env: { NODE_ENV: "production", SEVO_RUNTIME_ENV: "production" },
      url: "http://127.0.0.1:3511/checkout/delivery",
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
