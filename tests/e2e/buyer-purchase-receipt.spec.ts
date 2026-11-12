import { expect, test } from "../helpers/release-playwright";
import {
  assertInteractiveTargets,
  assertMinimumContrast,
  assertNoHorizontalOverflow,
} from "../helpers/visual-assertions";

const groupId = "087d7108-c1c3-423a-986e-6aa8b448f919";
const storeId = "e234d421-7ca7-4772-8b7d-d8427e288805";
const orderId = "b8e3d629-8115-4dfd-88bc-26984d5d04c8";
const money = { amount: 3250000, currency: "IRR" };

for (const [status, label] of [
  ["PENDING_PAYMENT", "در انتظار پرداخت"],
  ["PAID", "پرداخت ثبت شد"],
  ["PAYMENT_REVIEW", "پرداخت در حال بررسی"],
  ["EXPIRED", "مهلت پرداخت گذشته است"],
] as const) {
  test(`purchase receipt displays ${status} and store tracking`, async ({ page }) => {
    await page.route(`**/api/purchase-groups/${groupId}`, (route) =>
      route.fulfill({
        json: {
          groupId,
          status,
          total: money,
          createdAt: "2026-11-08T12:00:00.000Z",
          reservationExpiresAt: "2026-11-08T13:00:00.000Z",
          stores: [
            {
              storeId,
              name: "فروشگاه نمونه",
              orderId,
              status: "PAID",
              total: money,
              shippingLabel: "پست پیشتاز",
              returnPolicyText: "مرجوعی تا هفت روز",
            },
          ],
        },
      }),
    );
    await page.goto(`/purchases/${groupId}`);
    await expect(page.getByText(label, { exact: true })).toBeVisible();
    await expect(page.getByText("مرجوعی: مرجوعی تا هفت روز")).toBeVisible();
    await expect(
      page.getByRole("link", { name: "پیگیری سفارش این فروشگاه" }),
    ).toHaveAttribute("href", `/orders/${orderId}`);
    await expect(page.getByRole("button", { name: /پرداخت آزمایشی/ })).toHaveCount(
      status === "PENDING_PAYMENT" ? 1 : 0,
    );
    if (status === "PAID")
      await expect(
        page.getByText("این پرداخت آزمایشی بود و پول واقعی جابه‌جا نشد."),
      ).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await assertNoHorizontalOverflow(page);
    await assertInteractiveTargets(page.locator("main a, main button"));
    await assertMinimumContrast(page.locator("main a, main button"));
    const tracking = page.getByRole("link", { name: "پیگیری سفارش این فروشگاه" });
    await tracking.focus();
    await expect(tracking).toBeFocused();
    expect(
      await tracking.evaluate((node) => getComputedStyle(node).outlineStyle),
    ).not.toBe("none");
  });
}

test("receipt load failure stops loading and allows retry", async ({ page }) => {
  let calls = 0;
  await page.route(`**/api/purchase-groups/${groupId}`, (route) => {
    calls++;
    return route.fulfill({ json: {} });
  });
  await page.goto(`/purchases/${groupId}`);
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByText("در حال آماده‌کردن رسید…")).toHaveCount(0);
  await page.getByRole("button", { name: "تلاش دوباره" }).click();
  await expect.poll(() => calls).toBe(2);
});
