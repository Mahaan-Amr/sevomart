import { expect, test } from "@playwright/test";

test("seller signs in with the visible development OTP and keeps the session", async ({
  page,
}) => {
  const externalRequests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (!["127.0.0.1", "localhost"].includes(url.hostname)) {
      externalRequests.push(request.url());
    }
  });

  await page.goto("/seller/login");
  await expect(
    page.getByRole("heading", { name: "ورود به فضای فروشنده" }),
  ).toBeVisible();

  const mobile = page.getByLabel("شماره موبایل");
  await mobile.fill("09120000000");
  await page.getByRole("button", { name: "دریافت کد" }).click();
  await expect(
    page.getByText("این شماره برای ورود آزمایشی در دسترس نیست."),
  ).toBeVisible();

  await mobile.fill("09123456789");
  await page.getByRole("button", { name: "دریافت کد" }).click();
  await expect(page.getByText("کد آزمایشی", { exact: true })).toBeVisible();
  await expect(page.getByText("111111", { exact: true })).toBeVisible();

  const code = page.getByLabel("کد شش‌رقمی");
  await expect(code).toBeFocused();
  await code.fill("222222");
  await page.getByRole("button", { name: "ورود" }).click();
  await expect(page.getByText("کد واردشده درست نیست.")).toBeVisible();

  await code.fill("111111");
  await page.getByRole("button", { name: "ورود" }).click();
  await expect(page.getByRole("heading", { name: "وارد شدید" })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("heading", { name: "وارد شدید" })).toBeVisible();
  expect(externalRequests).toEqual([]);
});

test("login is fully reachable by keyboard with a visible focus", async ({ page }) => {
  await page.goto("/seller/login");
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("شماره موبایل")).toBeFocused();
  await expect(page.getByLabel("شماره موبایل")).toHaveCSS("outline-style", "solid");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "دریافت کد" })).toBeFocused();
});
