import { expect, test } from "@playwright/test";

const orderId = "47a3f408-858c-45d7-a0bd-ab84a28718ef";
const attemptId = "91fe87eb-6c0f-47ca-93ca-9f9a038ca273";

test("buyer sees a direct-payment receipt and the next step", async ({ page }) => {
  await page.route(`**/api/payment-attempts/${attemptId}`, (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        attemptId,
        orderId,
        status: "CONFIRMED",
        amount: { amount: 4_500_000, currency: "IRR" },
        provider: "DEV",
        providerReference: `dev-${attemptId}`,
        createdAt: "2026-08-25T08:00:00.000Z",
        confirmedAt: "2026-08-25T08:02:00.000Z",
      }),
    }),
  );

  await page.goto(`/orders/${orderId}?attemptId=${attemptId}`);
  await expect(page.getByRole("heading", { name: "پرداخت تأیید شد" })).toBeVisible();
  await expect(page.getByText("تسویه مستقیم با فروشگاه")).toBeVisible();
  await expect(
    page.getByText("قدم بعدی: فروشگاه سفارش را آماده می‌کند."),
  ).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
});

test("seller sees only the paid actionable order", async ({ page }) => {
  await page.route("**/api/seller/orders", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        orders: [
          {
            orderId,
            status: "PAID",
            total: { amount: 4_500_000, currency: "IRR" },
            paidAt: "2026-08-25T08:02:00.000Z",
            createdAt: "2026-08-25T08:00:00.000Z",
            itemCount: 1,
          },
        ],
      }),
    }),
  );

  await page.goto("/seller/orders");
  await expect(
    page.getByRole("heading", { name: "سفارش‌های آماده اقدام" }),
  ).toBeVisible();
  await expect(page.getByText(`سفارش ${orderId}`)).toBeVisible();
  await expect(page.getByText("۱ کالا")).toBeVisible();
});
