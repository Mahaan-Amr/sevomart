import { expect, test } from "@playwright/test";

import {
  assertMinimumContrast,
  assertNoHorizontalOverflow,
} from "../helpers/visual-assertions";
import { establishPlatformAgentSession } from "../helpers/platform-agent-session";

test("a single live responsibility enters its queue directly", async ({
  context,
  page,
}) => {
  await establishPlatformAgentSession(context, ["SELLER_APPLICATION_REVIEW"]);
  await page.goto("/platform");

  await expect(page).toHaveURL(/\/platform\/seller-applications$/);
  await openMobileResponsibilities(page);
  await expect(
    page.getByRole("link", { name: /بررسی درخواست‌های فروشندگی/ }).first(),
  ).toBeVisible();
  await expect(page.getByText("پرداخت‌ها")).toHaveCount(0);
});

test("multiple live responsibilities open a focused responsibility home", async ({
  context,
  page,
}) => {
  await establishPlatformAgentSession(context, [
    "PAYMENT_REVIEW",
    "SELLER_APPLICATION_REVIEW",
  ]);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/platform");

  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(
    page.getByRole("heading", { name: "مسئولیت‌های فعال شما" }),
  ).toBeVisible();
  const sellerQueue = page
    .getByRole("link", {
      name: /بررسی درخواست‌های فروشندگی/,
    })
    .last();
  const paymentQueue = page.getByRole("link", { name: /بررسی پرداخت‌ها/ }).last();
  await expect(sellerQueue).toBeVisible();
  await expect(paymentQueue).toBeVisible();
  await sellerQueue.focus();
  await expect(sellerQueue).toHaveCSS("outline-style", "solid");
  await assertMinimumContrast(sellerQueue);
  await assertNoHorizontalOverflow(page);
});

test("revocation removes navigation and blocks the route on the next request", async ({
  context,
  page,
}) => {
  const agent = await establishPlatformAgentSession(context, [
    "SELLER_APPLICATION_REVIEW",
  ]);
  await page.goto("/platform/seller-applications");
  await openMobileResponsibilities(page);
  await expect(
    page.getByRole("link", { name: /بررسی درخواست‌های فروشندگی/ }).first(),
  ).toBeVisible();

  await agent.revoke("SELLER_APPLICATION_REVIEW");
  await page.goto("/platform/seller-applications");

  await expect(
    page.getByRole("heading", { name: "مجوز فعالی برای این فضا ندارید" }),
  ).toBeVisible();
  await expect(page.getByText("درخواست‌ها")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "خروج امن" })).toBeVisible();
});

test("an agent without a live responsibility can safely sign out", async ({
  context,
  page,
}) => {
  await establishPlatformAgentSession(context, []);
  await page.goto("/platform");
  await expect(
    page.getByRole("heading", { name: "مجوز فعالی برای این فضا ندارید" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "خروج امن" }).click();
  await expect(page).toHaveURL(/\/platform\/login$/);
  await page.goto("/platform");
  await expect(page).toHaveURL(/\/platform\/login\?returnTo=%2Fplatform$/);
});

async function openMobileResponsibilities(page: import("@playwright/test").Page) {
  const trigger = page.getByText("مسئولیت‌ها", { exact: true });
  if (await trigger.isVisible()) await trigger.click();
}
