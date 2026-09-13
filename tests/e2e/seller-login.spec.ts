import { expect, expectCandidateResponse, test } from "../helpers/release-playwright";

import {
  assertMinimumContrast,
  assertNoHorizontalOverflow,
} from "../helpers/visual-assertions";

test.describe.configure({ mode: "serial" });

test("guest signs in with the visible development OTP, returns to the prior action and can sign out", async ({
  page,
}) => {
  const externalRequests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (!["127.0.0.1", "localhost"].includes(url.hostname)) {
      externalRequests.push(request.url());
    }
  });

  await page.goto("/seller/login?returnTo=%2Fseller%2Fstore%3Fstep%3Dshipping");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator("html")).toHaveAttribute("lang", "fa");
  await expect(page.getByRole("heading", { name: "ورود به سوو" })).toBeVisible();

  const mobile = page.getByLabel("شماره موبایل");
  await mobile.fill("09123456789");
  await page.getByRole("button", { name: "دریافت کد" }).click();
  await expect(page.getByText("کد آزمایشی", { exact: true })).toBeVisible();
  await expect(page.getByText("111111", { exact: true })).toBeVisible();

  const code = page.getByLabel("کد شش‌رقمی");
  await expect(code).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "ورود" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "تغییر شماره" })).toBeFocused();
  await code.fill("222222");
  await page.getByRole("button", { name: "ورود" }).click();
  await expect(page.getByText("کد واردشده درست نیست.")).toBeVisible();

  await code.fill("111111");
  await page.getByRole("button", { name: "ورود" }).click();
  await expect(page.getByRole("heading", { name: "وارد شدید" })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("heading", { name: "وارد شدید" })).toBeVisible();
  await expect(page.getByRole("link", { name: "ادامه کار" })).toHaveAttribute(
    "href",
    "/seller/store?step=shipping",
  );
  await page.getByRole("button", { name: "خروج" }).click();
  await expect(page.getByRole("heading", { name: "ورود به سوو" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "ورود به سوو" })).toBeVisible();
  expect(externalRequests).toEqual([]);
});

test("login is fully reachable by keyboard with a visible focus", async ({ page }) => {
  await page.goto("/seller/login");
  await expect(page.getByLabel("شماره موبایل")).toBeEditable();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("شماره موبایل")).toBeFocused();
  await expect(page.getByLabel("شماره موبایل")).toHaveCSS("outline-style", "solid");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "دریافت کد" })).toBeFocused();
});

test("a forged session cookie is rejected against PostgreSQL", async ({
  context,
  page,
}) => {
  await context.addCookies([
    {
      name: "sevo_session",
      value: "forged",
      domain: "127.0.0.1",
      path: "/",
    },
  ]);
  await page.goto("/seller/login");
  await expect(page.getByRole("heading", { name: "ورود به سوو" })).toBeVisible();
});

test("server failure stays human and the login honors visual accessibility", async ({
  page,
}, testInfo) => {
  expectCandidateResponse(testInfo, "login-recovery");
  const longServerMessage =
    "ارتباط با سرور برقرار نشد. چند لحظه صبر کنید و دوباره برای ورود به فضای فروشنده تلاش کنید.";
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("**/api/auth/otp/requests", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        code: "INTERNAL_SERVER_ERROR",
        message: longServerMessage,
        correlationId: "e2e-server-error",
      }),
    }),
  );
  await page.goto("/seller/login");

  const input = page.getByLabel("شماره موبایل");
  const button = page.getByRole("button", { name: "دریافت کد" });
  await input.fill("09123456789");
  await button.click();
  await expect(page.getByText(longServerMessage)).toBeVisible();
  await assertNoHorizontalOverflow(page);

  const inputTransitionSeconds = Number.parseFloat(
    await input.evaluate((element) => getComputedStyle(element).transitionDuration),
  );
  expect(inputTransitionSeconds).toBeLessThan(0.001);

  await assertMinimumContrast(button);
});
