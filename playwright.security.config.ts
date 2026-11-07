import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "platform-totp-security.spec.ts",
  workers: 1,
  use: {
    baseURL: process.env.SECURITY_WEB_URL ?? "http://127.0.0.1:3210",
    browserName: "chromium",
    channel: "chrome",
    locale: "fa-IR",
  },
});
