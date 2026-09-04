import { defineConfig, devices } from "@playwright/test";

import baseConfig from "./playwright.config";

const webkitSmoke = /(?:guest-cart-login|direct-payment-success)\.spec\.ts/;
const releaseRunId = process.env.SEVO_RELEASE_RUN_ID ?? "manual";
const releaseOutput = `output/release-evidence/${process.env.GITHUB_SHA ?? "local"}/${releaseRunId}`;

export default defineConfig(baseConfig, {
  forbidOnly: true,
  fullyParallel: false,
  retries: 0,
  workers: 1,
  outputDir: `${releaseOutput}/playwright-results`,
  use: {
    ...baseConfig.use,
    channel: undefined,
  },
  reporter: [
    ["json", { outputFile: `${releaseOutput}/playwright-results.json` }],
    ["html", { open: "never", outputFolder: `${releaseOutput}/playwright-report` }],
  ],
  projects: [
    ...(baseConfig.projects ?? []),
    {
      name: "webkit-390x844",
      testMatch: webkitSmoke,
      use: {
        ...devices["Desktop Safari"],
        viewport: { width: 390, height: 844 },
        locale: "fa-IR",
        timezoneId: "Asia/Tehran",
      },
    },
    {
      name: "webkit-1440x900",
      testMatch: webkitSmoke,
      use: {
        ...devices["Desktop Safari"],
        viewport: { width: 1440, height: 900 },
        locale: "fa-IR",
        timezoneId: "Asia/Tehran",
      },
    },
  ],
});
