import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://127.0.0.1:3108",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "mobile-chromium",
      use: {
        ...devices["Pixel 7"],
        channel: process.env.CI ? undefined : "chrome",
        reducedMotion: "reduce",
      },
    },
    {
      name: "desktop-chromium",
      use: {
        ...devices["Desktop Chrome"],
        channel: process.env.CI ? undefined : "chrome",
        reducedMotion: "reduce",
      },
    },
  ],
  webServer: {
    command: "pnpm --filter @sevo/web dev --port 3108",
    url: "http://127.0.0.1:3108",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
