import { defineConfig } from "@playwright/test";

import {
  acceptanceTestMobiles,
  storefrontTestMobiles,
  visualViewports,
} from "./tests/helpers/visual-projects";

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
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
        ].join(","),
      },
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: "pnpm e2e:web",
      url: "http://127.0.0.1:3110",
      env: {
        API_BASE_URL: "http://127.0.0.1:3109",
        SEVO_RUNTIME_ENV: "test",
      },
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
