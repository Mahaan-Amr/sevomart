import { defineConfig, devices } from "@playwright/test";
import { readFileSync } from "node:fs";

import baseConfig from "./playwright.config";

const manifest = JSON.parse(
  readFileSync(new URL("./ops/qa/release-evidence-manifest.v1.json", import.meta.url), "utf8"),
) as { journeys: Array<{ tests: { e2e: string[] } }> };

const releaseTestFiles = new RegExp(
  `(?:${[
    ...new Set(manifest.journeys.flatMap((journey) => journey.tests.e2e)),
  ]
    .map((file) => file.split("/").at(-1)!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|")})$`,
);

const webkitSmoke =
  /(?:guest-cart-login|direct-payment-success|login-hydration)\.spec\.ts/;
const releaseRunId = process.env.SEVO_RELEASE_RUN_ID ?? "manual";
const releaseOutput = `output/release-evidence/${process.env.GITHUB_SHA ?? "local"}/${releaseRunId}`;
const chromiumChannel = process.env.SEVO_RELEASE_CHROMIUM_CHANNEL;
if (chromiumChannel !== undefined && chromiumChannel !== "chrome") {
  throw new Error("The optional release Chromium channel must be chrome");
}
if (
  process.argv.some(
    (argument) =>
      argument === "-u" ||
      argument === "--update-snapshots" ||
      (argument.startsWith("--update-snapshots=") &&
        argument !== "--update-snapshots=none"),
  )
) {
  throw new Error("Release candidates cannot update visual baselines");
}

export default defineConfig(baseConfig, {
  forbidOnly: true,
  fullyParallel: false,
  retries: 0,
  updateSnapshots: "none",
  workers: 1,
  outputDir: `${releaseOutput}/playwright-results`,
  use: {
    ...baseConfig.use,
    channel: undefined,
    screenshot: "off",
    trace: "off",
    video: "off",
  },
  reporter: [["./scripts/qa/release-reporter.mjs", { outputDir: releaseOutput }]],
  projects: [
    ...(baseConfig.projects ?? []).map((project) => ({
      ...project,
      testMatch: releaseTestFiles,
      use: { ...project.use, channel: chromiumChannel },
    })),
    {
      name: "webkit-390x844",
      testMatch: webkitSmoke,
      use: {
        ...devices["Desktop Safari"],
        browserName: "webkit",
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
        browserName: "webkit",
        viewport: { width: 1440, height: 900 },
        locale: "fa-IR",
        timezoneId: "Asia/Tehran",
      },
    },
  ],
});
