import { expect, test } from "@playwright/test";
import { ordersV1Examples } from "@sevo/contracts/orders/v1";

test("payment action reflects the server runtime", async ({ page }, testInfo) => {
  const source = ordersV1Examples.CheckoutPreparation;
  const expiresAt = new Date(Date.now() + 600_000).toISOString();
  await page.route("**/api/checkout/v2/options", (route) =>
    route.fulfill({
      json: {
        cart: ordersV1Examples.CheckoutOptions.cart,
        stores: [
          {
            storeId: source.store.storeId,
            name: source.store.name,
            shippingMethods: ordersV1Examples.CheckoutOptions.shippingMethods,
          },
        ],
        addresses: ordersV1Examples.CheckoutOptions.addresses,
      },
    }),
  );
  await page.route("**/api/checkout/v2/prepare", (route) =>
    route.fulfill({
      json: {
        checkoutRevision: "b68f47bf-a4b2-47f4-84f9-f64710a58f38",
        expiresAt,
        cart: source.cart,
        stores: [{ ...source, expiresAt }],
        total: source.total,
      },
    }),
  );
  await page.goto("/checkout/delivery");
  await page.getByRole("button", { name: "مرور مبلغ نهایی" }).click();
  await expect(page).toHaveURL(/\/checkout\/review$/);
  const button = page.getByRole("button", { name: "ثبت خرید و ادامه به پرداخت" });
  if (testInfo.project.name === "production") {
    await expect(button).toBeDisabled();
    await expect(
      page.getByText("پرداخت یک‌جای واقعی پس از آماده‌شدن ارائه‌دهنده فعال می‌شود."),
    ).toBeVisible();
  } else {
    await expect(button).toBeEnabled();
    await expect(
      page.getByText(
        "این پرداخت فقط آزمایشی و در محیط توسعه است؛ پول واقعی جابه‌جا نمی‌شود.",
      ),
    ).toBeVisible();
  }
});
