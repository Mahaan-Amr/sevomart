import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 120000,
  workers: 1,
  retries: 0,
  reporter: "list",
  use: { baseURL: "http://127.0.0.1:3543", browserName: "chromium", channel: "chrome", locale: "fa-IR", timezoneId: "Asia/Tehran", viewport: { width: 360, height: 800 } },
  projects: [{ name: "chromium-360x800" }],
  webServer: { command: "pnpm --filter @sevo/web exec next dev --port 3543", url: "http://127.0.0.1:3543", timeout: 120000, env: { API_BASE_URL: "http://127.0.0.1:1" } },
});
