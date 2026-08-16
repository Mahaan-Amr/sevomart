import { defineConfig } from "@playwright/test";

const visualViewports = [
  { name: "chromium-360x800", width: 360, height: 800 },
  { name: "chromium-390x844", width: 390, height: 844 },
  { name: "chromium-768x1024", width: 768, height: 1024 },
  { name: "chromium-1440x900", width: 1440, height: 900 },
] as const;

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
    baseURL: "http://127.0.0.1:3108",
    browserName: "chromium",
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
      channel: process.env.CI ? undefined : "chrome",
      viewport: { width, height },
    },
  })),
  webServer: {
    command: "pnpm --filter @sevo/web dev --port 3108",
    url: "http://127.0.0.1:3108",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
