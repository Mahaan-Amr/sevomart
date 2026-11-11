import { randomUUID } from "node:crypto";

import { expect, expectCandidateResponse, test } from "../helpers/release-playwright";
import { captureReleaseCheckpoint } from "../helpers/release-checkpoint";

import {
  assertInteractiveTargets,
  assertMinimumContrast,
  assertNoHorizontalOverflow,
} from "../helpers/visual-assertions";
import {
  sellerFulfillmentTestMobiles,
  visualProjectIndex,
} from "../helpers/visual-projects";
import { createSellerWorkspaceFixture } from "../helpers/seller-workspace-fixture";

test("seller advances the nearest fulfillment step and recovers from a conflict", async ({
  page,
}, testInfo) => {
  expectCandidateResponse(testInfo, "fulfillment-conflict");
  const index = visualProjectIndex(testInfo.project.name);
  const mobile = sellerFulfillmentTestMobiles[index]!;
  const orderId = randomUUID();
  const deniedOrderId = randomUUID();
  const preparingOrderId = randomUUID();
  const shippedOrderId = randomUUID();
  const awaitingProjectionId = randomUUID();
  const refundOrderId = randomUUID();
  let status: "ACTION_REQUIRED" | "PREPARING" | "SHIPPED" | "DELIVERED" =
    "ACTION_REQUIRED";
  const timelineStatuses = ["ACTION_REQUIRED"] as Array<typeof status>;
  let shippingConflictReturned = false;
  let listMode: "loading" | "failure" | "special" | "ready" = "loading";
  let releaseLoading!: () => void;
  const loadingGate = new Promise<void>((resolve) => {
    releaseLoading = resolve;
  });
  const longShippingMethod =
    "ارسال ویژه فروشگاه با پست پیشتاز و تحویل هماهنگ‌شده در نشانی خریدار";

  await page.emulateMedia({ reducedMotion: "reduce" });
  const fixture = await createSellerWorkspaceFixture(page, {
    mobile,
    slug: `fulfillment-${index}`,
    storeName: "خانه انجام سفارش",
  });
  const { identityId } = fixture;

  await page.route("**/api/seller/orders/*/fulfillment**", async (route) => {
    for (const [id, current, next] of [
      [preparingOrderId, "PREPARING", "SHIPPED"],
      [shippedOrderId, "SHIPPED", "DELIVERED"],
    ] as const) {
      if (route.request().url().includes(id)) {
        await route.fulfill({
          json: {
            orderId: id,
            status: current,
            nextStatus: next,
            timeline: [
              {
                status: current,
                actor: { type: "SYSTEM" },
                occurredAt: "2026-08-31T08:00:00.000Z",
                correlationId: randomUUID(),
              },
            ],
          },
        });
        return;
      }
    }
    if (route.request().url().includes(awaitingProjectionId)) {
      await route.fulfill({ status: 404, json: {} });
      return;
    }
    if (route.request().url().includes(deniedOrderId)) {
      await route.fulfill({
        status: 200,
        json: {
          orderId: deniedOrderId,
          status: "DELIVERED",
          timeline: [
            {
              status: "DELIVERED",
              actor: { type: "SYSTEM" },
              occurredAt: "2026-08-31T08:00:00.000Z",
              correlationId: randomUUID(),
            },
          ],
        },
      });
      return;
    }
    if (route.request().method() === "POST") {
      const input = route.request().postDataJSON() as { targetStatus: typeof status };
      if (input.targetStatus === "SHIPPED" && !shippingConflictReturned) {
        shippingConflictReturned = true;
        await route.fulfill({
          status: 409,
          json: {
            code: "IDEMPOTENCY_IN_PROGRESS",
            message: "درخواست مشابه هنوز در حال انجام است.",
          },
        });
        return;
      }
      status = input.targetStatus;
      timelineStatuses.push(status);
    }
    const nextStatus = {
      ACTION_REQUIRED: "PREPARING",
      PREPARING: "SHIPPED",
      SHIPPED: "DELIVERED",
      DELIVERED: undefined,
    }[status];
    await route.fulfill({
      status: 200,
      json: {
        orderId,
        status,
        ...(nextStatus ? { nextStatus } : {}),
        timeline: timelineStatuses.map((entryStatus, entryIndex) => ({
          status: entryStatus,
          actor:
            entryStatus === "ACTION_REQUIRED"
              ? { type: "SYSTEM" }
              : { type: "IDENTITY", id: identityId },
          occurredAt: `2026-08-31T${String(7 + entryIndex).padStart(2, "0")}:00:00.000Z`,
          correlationId: randomUUID(),
          ...(entryStatus === "SHIPPED"
            ? {
                shipping: {
                  method: longShippingMethod,
                  trackingCode: "1234567890",
                },
              }
            : {}),
        })),
      },
    });
  });
  await page.route("**/api/seller/orders", async (route) => {
    if (listMode === "loading") {
      await loadingGate;
      await route.fulfill({ json: { orders: [] } });
      return;
    }
    if (listMode === "failure") {
      await route.fulfill({ status: 503, json: {} });
      return;
    }
    if (listMode === "special") {
      await route.fulfill({
        json: {
          orders: [
            {
              orderId: awaitingProjectionId,
              status: "PAID",
              total: { amount: 100000, currency: "IRR" },
              paidAt: "2026-08-31T07:00:00.000Z",
              createdAt: "2026-08-31T06:00:00.000Z",
              itemCount: 1,
            },
            {
              orderId: refundOrderId,
              status: "CANCELLATION_PENDING_REFUND",
              total: { amount: 100000, currency: "IRR" },
              paidAt: "2026-08-31T07:00:00.000Z",
              createdAt: "2026-08-31T06:00:00.000Z",
              itemCount: 1,
            },
          ],
        },
      });
      return;
    }
    await route.fulfill({
      status: 200,
      json: {
        orders: [orderId, deniedOrderId, preparingOrderId, shippedOrderId].map(
          (listedOrderId) => ({
            orderId: listedOrderId,
            status: "PAID",
            total: { amount: 12_500_000, currency: "IRR" },
            paidAt: "2026-08-31T07:00:00.000Z",
            createdAt: "2026-08-31T06:00:00.000Z",
            itemCount: 2,
            itemNames: ["ماگ سرامیکی", "بشقاب"],
          }),
        ),
      },
    });
  });

  try {
    await page.goto("/seller/orders");
    await expect(page.getByRole("status")).toContainText("در حال دریافت سفارش‌ها");
    releaseLoading();
    await expect(page.getByText("فعلاً سفارشی برای اقدام ندارید.")).toBeVisible();
    listMode = "failure";
    await page.reload();
    await expect(
      page.getByRole("alert").filter({ hasText: "سفارش‌ها دریافت نشدند" }),
    ).toBeVisible();
    listMode = "special";
    await page.reload();
    await expect(
      page.getByRole("region", { name: "در حال بررسی وضعیت" }),
    ).toBeVisible();
    await expect(
      page.getByRole("region", { name: "در انتظار بازپرداخت" }),
    ).toBeVisible();
    await expect(page.getByText("وضعیت در حال بررسی")).toBeVisible();
    await expect(
      page
        .getByRole("region", { name: "در انتظار بازپرداخت" })
        .getByText("در انتظار بازپرداخت", { exact: true })
        .last(),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "دیدن وضعیت بازپرداخت" }),
    ).toHaveAttribute("href", `/seller/orders/${refundOrderId}/refund`);
    listMode = "ready";
    await page.reload();
    await expect(page.getByRole("region", { name: "نیازمند اقدام" })).toBeVisible();
    await expect(page.getByRole("region", { name: "در حال آماده‌سازی" })).toBeVisible();
    await expect(page.getByRole("region", { name: "ارسال‌شده" })).toBeVisible();
    await expect(
      page
        .getByRole("region", { name: "نیازمند اقدام" })
        .getByText("ماگ سرامیکی، بشقاب"),
    ).toBeVisible();
    await expect(page.getByText(deniedOrderId)).toHaveCount(0);
    await expect(page.getByText("نیازمند شروع آماده‌سازی")).toBeVisible();
    const firstOrder = page.getByRole("region", { name: "نیازمند اقدام" });
    await expect(firstOrder.getByText("۲ کالا")).toBeVisible();
    await expect(firstOrder.getByText("ثبت سفارش:", { exact: false })).toBeVisible();
    await firstOrder.getByText("شناسه سفارش", { exact: true }).click();
    await expect(page.getByText(orderId, { exact: true })).toBeVisible();
    await assertNoHorizontalOverflow(page);
    await assertInteractiveTargets(
      firstOrder.getByRole("link", { name: "انجام سفارش" }),
    );
    await assertMinimumContrast(firstOrder.getByRole("link", { name: "انجام سفارش" }));
    await firstOrder.getByRole("link", { name: "انجام سفارش" }).focus();
    await expect(firstOrder.getByRole("link", { name: "انجام سفارش" })).toBeFocused();
    await expect(page.getByRole("link", { name: "انجام سفارش" })).toHaveCount(3);
    await firstOrder.getByRole("link", { name: "انجام سفارش" }).click();
    await expect(page).toHaveURL(new RegExp(`/seller/orders/${orderId}$`));
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.getByRole("heading", { name: "انجام سفارش" })).toBeVisible();
    await page.getByRole("button", { name: "شروع آماده‌سازی" }).click();
    await expect(
      page.getByRole("heading", { name: "آماده‌سازی سفارش شروع شد" }),
    ).toBeFocused();
    await page.getByRole("button", { name: "ثبت ارسال سفارش" }).click();
    await expect(page.locator("p[role=alert]")).toBeFocused();
    await expect(page.locator("p[role=alert]")).toContainText("روش ارسال");
    await expect(page.getByLabel("روش ارسال")).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByLabel("کد رهگیری")).toHaveAttribute("aria-invalid", "false");
    await page.getByLabel("روش ارسال").fill(longShippingMethod);
    await page.getByLabel("کد رهگیری").fill("۱");
    await page.getByRole("button", { name: "ثبت ارسال سفارش" }).click();
    await expect(page.locator("p[role=alert]")).toBeFocused();
    await expect(page.getByLabel("کد رهگیری")).toHaveAttribute("aria-invalid", "true");
    await page.getByLabel("کد رهگیری").fill("1234567890");
    const submit = page.getByRole("button", { name: "ثبت ارسال سفارش" });
    await assertInteractiveTargets(submit);
    await assertMinimumContrast(submit);
    await submit.click();
    await expect(page.locator("p[role=alert]")).toBeFocused();
    await expect(page.locator("p[role=alert]")).toContainText("هنوز در حال انجام است");
    await expect(page.getByLabel("روش ارسال")).toHaveAttribute("aria-invalid", "false");
    await expect(page.getByLabel("کد رهگیری")).toHaveAttribute("aria-invalid", "false");
    await expect(page.getByText("در حال آماده‌سازی").first()).toBeVisible();
    await submit.click();
    await expect(page.getByRole("heading", { name: "سفارش ارسال شد" })).toBeFocused();
    await expect(page.getByText(longShippingMethod)).toBeVisible();
    await expect(page.getByText("1234567890")).toBeVisible();
    await expect(
      page.locator('time[datetime="2026-08-31T09:00:00.000Z"]'),
    ).toContainText(/[۰-۹]/);
    await expect(
      page.getByRole("link", { name: "لغو پیش از ارسال و پیگیری بازپرداخت" }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "ثبت تحویل سفارش" }).click();
    await expect(
      page.getByRole("heading", { name: "تحویل سفارش ثبت شد" }),
    ).toBeFocused();
    await assertNoHorizontalOverflow(page);
    await captureReleaseCheckpoint(page, testInfo, {
      cellId: "seller-fulfillment:success",
      name: "seller-fulfillment",
      sensitiveRegions: [],
    });

    await page.reload();
    await expect(
      page.getByRole("heading", { name: "این سفارش برای اقدام در دسترس نیست" }),
    ).toBeVisible();
    await expect(page.getByText(orderId)).toHaveCount(0);

    await page.goto(`/seller/orders/${deniedOrderId}`);
    await expect(
      page.getByRole("heading", { name: "این سفارش برای اقدام در دسترس نیست" }),
    ).toBeVisible();
    await expect(page.getByText(deniedOrderId)).toHaveCount(0);
  } finally {
    await fixture.cleanup();
  }
});
