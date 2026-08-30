import { defineConfig } from "@playwright/test";

import {
  acceptanceTestMobiles,
  differentStoreCartConflictTestMobiles,
  sellerApplicationDraftTestMobiles,
  sellerWorkspaceTestMobiles,
  sellerConversationTestMobiles,
  buyerConversationTestMobiles,
  otherSellerConversationTestMobiles,
  productTracerTestMobiles,
  sellerInventoryTestMobiles,
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

const e2eApiPort = process.env.SEVO_E2E_API_PORT ?? "3109";
const e2eWebPort = process.env.SEVO_E2E_WEB_PORT ?? "3110";
const e2eWorkerPort = process.env.SEVO_E2E_WORKER_PORT ?? "3108";
const e2eApiUrl = `http://127.0.0.1:${e2eApiPort}`;
const e2eWebUrl = `http://127.0.0.1:${e2eWebPort}`;

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
    baseURL: e2eWebUrl,
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
      url: `${e2eApiUrl}/v1/health`,
      env: {
        API_PORT: e2eApiPort,
        DEV_OTP_TEST_MOBILES: [
          "09123456789",
          "09111111111",
          ...storefrontTestMobiles,
          ...acceptanceTestMobiles,
          ...sellerApplicationDraftTestMobiles,
          ...sellerWorkspaceTestMobiles,
          ...sellerConversationTestMobiles,
          ...buyerConversationTestMobiles,
          ...otherSellerConversationTestMobiles,
          ...productTracerTestMobiles,
          ...sellerInventoryTestMobiles,
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
      url: e2eWebUrl,
      env: {
        API_BASE_URL: e2eApiUrl,
        WEB_PORT: e2eWebPort,
        SEVO_RUNTIME_ENV: "test",
      },
      reuseExistingServer: process.env.SEVO_E2E_ISOLATED !== "1" && !process.env.CI,
      timeout: 120_000,
    },
    {
      command: "pnpm e2e:worker",
      url: "http://127.0.0.1:3108/health/ready",
      ...(process.env.SEVO_E2E_WORKER_PORT
        ? { url: `http://127.0.0.1:${e2eWorkerPort}/health/ready` }
        : {}),
      env: {
        WORKER_PORT: e2eWorkerPort,
        API_READINESS_URL: `${e2eApiUrl}/health/ready`,
        INTERNAL_API_URL: e2eApiUrl,
      },
      reuseExistingServer: process.env.SEVO_E2E_ISOLATED !== "1" && !process.env.CI,
      timeout: 120_000,
    },
  ],
});
