import { defineConfig } from "@playwright/test";

import {
  acceptanceTestMobiles,
  differentStoreCartConflictTestMobiles,
  sellerApplicationDraftTestMobiles,
  productTracerTestMobiles,
  guestCartTestMobiles,
  sameStoreCartConflictTestMobiles,
  storefrontTestMobiles,
  paymentBuyerTestMobiles,
  paymentSellerTestMobiles,
  releaseAgentTestMobiles,
  releaseBuyerTestMobiles,
  releaseSellerTestMobiles,
  visualViewports,
} from "./tests/helpers/visual-projects";

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  workers: process.env.CI ? 1 : 2,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI
    ? [
        ["github"],
        ["html", { open: "never", outputFolder: "output/playwright-report" }],
      ]
    : "list",
  outputDir: "output/playwright-results",
  snapshotPathTemplate:
    "{testDir}/__screenshots__/{testFilePath}/{projectName}/{arg}{ext}",
  use: {
    baseURL: "http://127.0.0.1:3110",
    browserName: "chromium",
    channel: "chrome",
    locale: "fa-IR",
    timezoneId: "Asia/Tehran",
    colorScheme: "light",
    reducedMotion: "no-preference",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
  projects: visualViewports.map(({ name, width, height }) => ({
    name,
    use: {
      viewport: { width, height },
    },
  })),
  webServer: [
    {
      command: "pnpm e2e:api",
      url: "http://127.0.0.1:3109/v1/health",
      env: {
        API_PORT: "3109",
        DEV_OTP_TEST_MOBILES: [
          "09123456789",
          "09111111111",
          ...storefrontTestMobiles,
          ...acceptanceTestMobiles,
          ...sellerApplicationDraftTestMobiles,
          ...productTracerTestMobiles,
          ...guestCartTestMobiles,
          ...sameStoreCartConflictTestMobiles,
          ...differentStoreCartConflictTestMobiles,
          ...paymentBuyerTestMobiles,
          ...paymentSellerTestMobiles,
          ...releaseSellerTestMobiles,
          ...releaseAgentTestMobiles,
          ...releaseBuyerTestMobiles,
        ].join(","),
      },
      reuseExistingServer: process.env.SEVO_E2E_ISOLATED !== "1" && !process.env.CI,
      timeout: 120_000,
    },
    {
      command: "pnpm e2e:web",
      url: "http://127.0.0.1:3110",
      env: {
        API_BASE_URL: "http://127.0.0.1:3109",
        SEVO_RUNTIME_ENV: "test",
      },
      reuseExistingServer: process.env.SEVO_E2E_ISOLATED !== "1" && !process.env.CI,
      timeout: 120_000,
    },
    {
      command: "pnpm e2e:worker",
      url: "http://127.0.0.1:3108/health/ready",
      env: {
        WORKER_PORT: "3108",
        API_READINESS_URL: "http://127.0.0.1:3109/health/ready",
        INTERNAL_API_URL: "http://127.0.0.1:3109",
      },
      reuseExistingServer: process.env.SEVO_E2E_ISOLATED !== "1" && !process.env.CI,
      timeout: 120_000,
    },
  ],
});
