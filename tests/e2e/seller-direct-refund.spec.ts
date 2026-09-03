import { randomUUID } from "node:crypto";

import { expect, expectCandidateResponse, test } from "../helpers/release-playwright";

import {
  assertInteractiveTargets,
  assertMinimumContrast,
  assertNoHorizontalOverflow,
} from "../helpers/visual-assertions";
import {
  sellerRefundRecoveryTestMobiles,
  sellerRefundTestMobiles,
  visualProjectIndex,
} from "../helpers/visual-projects";
import { createSellerWorkspaceFixture } from "../helpers/seller-workspace-fixture";

test("seller requests cancellation while refund stays pending trusted verification", async ({
  page,
}, testInfo) => {
  expectCandidateResponse(testInfo, "direct-refund-empty");
  const index = visualProjectIndex(testInfo.project.name);
  const mobile = sellerRefundTestMobiles[index]!;
  const orderId = randomUUID();
  const attemptId = randomUUID();
  let requestSubmitted = false;

  await page.emulateMedia({ reducedMotion: "reduce" });
  const fixture = await createSellerWorkspaceFixture(page, {
    mobile,
    slug: `refund-${index}`,
    storeName: "خانه بازپرداخت",
  });

  await page.route(`**/api/seller/orders/${orderId}/direct-refund`, async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill(
        requestSubmitted
          ? {
              status: 200,
              json: {
                orderId,
                paymentAttemptId: attemptId,
                amount: { amount: 12_500_000, currency: "IRR" },
                status: "CONFIRMED",
                orderStatus: "CANCELLED",
                nextAction: "NONE",
                updatedAt: "2026-08-31T08:05:00.000Z",
              },
            }
          : { status: 404, json: { code: "REFUND_NOT_FOUND" } },
      );
      return;
    }
    requestSubmitted = true;
    await route.fulfill({
      status: 200,
      json: {
        orderId,
        paymentAttemptId: attemptId,
        amount: { amount: 12_500_000, currency: "IRR" },
        status: "PENDING",
        orderStatus: "CANCELLATION_PENDING_REFUND",
        nextAction: "WAIT_FOR_VERIFICATION",
        updatedAt: "2026-08-31T08:00:00.000Z",
      },
    });
  });

  try {
    await page.goto(`/seller/orders/${orderId}/refund`);
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(
      page.getByRole("heading", { name: "لغو و پیگیری بازپرداخت" }),
    ).toBeVisible();
    await expect(page.getByText(/بازپرداخت را تضمین نمی‌کند/)).toBeVisible();
    await page
      .getByLabel("دلیل لغو پیش از ارسال")
      .fill(
        "این توضیح بلند فارسی برای بررسی نمایش متن در موبایل و دسکتاپ است و روشن می‌کند کالا پیش از ارسال قابل تأمین نیست.",
      );
    const submit = page.getByRole("button", {
      name: "ثبت درخواست لغو و بررسی بازپرداخت",
    });
    await assertInteractiveTargets(submit);
    await assertMinimumContrast(submit);
    await submit.click();
    const result = page.getByRole("heading", {
      name: "لغو در انتظار تأیید بازپرداخت است",
    });
    await expect(result).toBeFocused();
    await expect(page.getByText("لغو در انتظار بازپرداخت")).toBeVisible();
    const confirmed = page.getByRole("heading", {
      name: "بازپرداخت تأیید و سفارش لغو شد",
    });
    await expect(confirmed).toBeFocused({ timeout: 7_000 });
    await expect(page.getByText("لغوشده")).toBeVisible();
    await assertNoHorizontalOverflow(page);
  } finally {
    await fixture.cleanup();
  }
});

test("provider failure stays unsuccessful until a valid retry succeeds", async ({
  page,
}, testInfo) => {
  expectCandidateResponse(testInfo, "direct-refund-recovery");
  const index = visualProjectIndex(testInfo.project.name);
  const mobile = sellerRefundRecoveryTestMobiles[index]!;
  const orderId = randomUUID();
  const attemptId = randomUUID();
  let submissions = 0;

  const fixture = await createSellerWorkspaceFixture(page, {
    mobile,
    slug: `refund-recovery-${index}`,
    storeName: "خانه بازیابی بازپرداخت",
  });

  await page.route(`**/api/seller/orders/${orderId}/direct-refund`, async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ status: 404, json: { code: "REFUND_NOT_FOUND" } });
      return;
    }
    submissions += 1;
    if (submissions === 1) {
      await route.fulfill({
        status: 503,
        json: {
          code: "PROVIDER_UNAVAILABLE",
          message: "نتیجه معتبر درگاه دریافت نشد. دوباره تلاش کنید.",
        },
      });
      return;
    }
    await route.fulfill({
      status: 200,
      json: {
        orderId,
        paymentAttemptId: attemptId,
        amount: { amount: 12_500_000, currency: "IRR" },
        status: "PENDING",
        orderStatus: "CANCELLATION_PENDING_REFUND",
        nextAction: "WAIT_FOR_VERIFICATION",
        updatedAt: "2026-08-31T08:00:00.000Z",
      },
    });
  });

  try {
    await page.goto(`/seller/orders/${orderId}/refund`);
    await page.getByLabel("دلیل لغو پیش از ارسال").fill("کالا پیش از ارسال تأمین نشد.");
    const submit = page.getByRole("button", {
      name: "ثبت درخواست لغو و بررسی بازپرداخت",
    });
    await submit.click();
    await expect(page.locator("p[role=alert]")).toContainText("نتیجه معتبر درگاه");
    await expect(
      page.getByRole("heading", { name: "لغو در انتظار تأیید بازپرداخت است" }),
    ).toHaveCount(0);
    await expect(submit).toBeEnabled();
    await submit.click();
    await expect(
      page.getByRole("heading", { name: "لغو در انتظار تأیید بازپرداخت است" }),
    ).toBeFocused();
  } finally {
    await fixture.cleanup();
  }
});
