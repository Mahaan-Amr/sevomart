import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/grid-e2e",
  testMatch: "discovery-store-grid.spec.ts",
  outputDir: "output/playwright-grid-results",
  use: {
    baseURL: "http://127.0.0.1:3339",
    browserName: "chromium",
    ...(process.env.CI ? {} : { channel: "chrome" }),
    locale: "fa-IR",
  },
  projects: [
    { name: "mobile-360", use: { viewport: { width: 360, height: 800 } } },
    { name: "mobile", use: { viewport: { width: 390, height: 844 } } },
    { name: "desktop", use: { viewport: { width: 1440, height: 900 } } },
  ],
  webServer: [
    {
      command: "node tests/helpers/grid-fixture-api.mjs",
      url: "http://127.0.0.1:3338/health",
      reuseExistingServer: false,
    },
    {
      command: "pnpm --filter @sevo/web exec next dev --port 3339",
      url: "http://127.0.0.1:3339",
      env: { API_BASE_URL: "http://127.0.0.1:3338" },
      reuseExistingServer: false,
      timeout: 120000,
    },
  ],
});
