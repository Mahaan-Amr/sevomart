import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/runtime",
  testMatch: "seller-invitation-unavailable.spec.ts",
  outputDir: "output/playwright-seller-invitation-error",
  use: {
    baseURL: "http://127.0.0.1:3529",
    browserName: "chromium",
    ...(process.env.CI ? {} : { channel: "chrome" }),
    locale: "fa-IR",
  },
  webServer: [
    {
      command: "node tests/helpers/seller-invitation-unavailable.mjs",
      url: "http://127.0.0.1:3528/health",
      reuseExistingServer: false,
    },
    {
      command: "pnpm e2e:web",
      env: {
        API_BASE_URL: "http://127.0.0.1:3528",
        WEB_PORT: "3529",
        SEVO_RUNTIME_ENV: "test",
      },
      url: "http://127.0.0.1:3529/",
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
