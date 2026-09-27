import { expect, test } from "../helpers/release-playwright";

import {
  assertInteractiveTargets,
  assertMinimumContrast,
  assertNoHorizontalOverflow,
} from "../helpers/visual-assertions";

test("cart keeps quantity controls together and explains the running total", async ({
  page,
}) => {
  const productId = "b8e3d629-8115-4dfd-88bc-26984d5d04c8";
  const variantId = "e782b598-8e16-47df-a1c7-fbdb70b67653";
  let quantity = 2;

  function cart() {
    return {
      cartId: "999e100e-1383-47e8-8ad6-9f2f4ec9ac37",
      revision: 1,
      reviewRequired: false,
      reviewChanges: [],
      stores: quantity
        ? [
            {
              storeId: "e234d421-7ca7-4772-8b7d-d8427e288805",
              name: "فنجان سرامیکی",
              slug: "khane-fenjan",
              subtotal: { amount: 4_500_000 * quantity, currency: "IRR" },
              items: [
                {
                  productId,
                  variantId,
                  name: "فنجان سرامیکی",
                  image: {
                    id: "e16ffbdf-2524-4edc-9716-06ad3c91bcc9",
                    url: "/v1/media/e16ffbdf-2524-4edc-9716-06ad3c91bcc9",
                  },
                  quantity,
                  unitPrice: { amount: 4_500_000, currency: "IRR" },
                  availability: "AVAILABLE",
                },
              ],
            },
          ]
        : [],
      subtotal: { amount: 4_500_000 * quantity, currency: "IRR" },
    };
  }

  await page.route(/\/api\/cart\/v2$/, (route) =>
    route.fulfill({ json: { cart: cart() } }),
  );
  await page.route(/\/api\/cart\/v2\/items\//, async (route) => {
    quantity = route.request().method() === "DELETE" ? 0 : 3;
    await route.fulfill({ json: cart() });
  });
  await page.route(/\/api\/store\/media\//, (route) =>
    route.fulfill({
      contentType: "image/png",
      body: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==",
        "base64",
      ),
    }),
  );

  await page.goto("/cart");
  await expect(page.getByRole("heading", { name: "سبد شما" })).toBeVisible();
  const panel = page.locator("main > section");
  const surface = await panel.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      panel: style.backgroundColor,
      page: getComputedStyle(document.body).backgroundColor,
      radius: Number.parseFloat(style.borderTopLeftRadius),
      border: style.borderTopWidth,
    };
  });
  expect(surface.panel).not.toBe(surface.page);
  expect(surface.radius).toBeGreaterThanOrEqual(18);
  expect(surface.border).not.toBe("0px");
  await expect(page.getByText("هر عدد ۴۵۰٬۰۰۰ تومان")).toBeVisible();
  await expect(page.getByText("۹۰۰٬۰۰۰ تومان")).toHaveCount(3);
  await expect(
    page.getByText("هزینهٔ ارسال هر فروشگاه", { exact: false }),
  ).toBeVisible();
  const controls = page.getByRole("group", { name: "تعداد فنجان سرامیکی" });
  const less = controls.getByRole("button", { name: "کم‌کردن تعداد فنجان سرامیکی" });
  const more = controls.getByRole("button", { name: "بیشترکردن تعداد فنجان سرامیکی" });
  const [lessBox, moreBox] = await Promise.all([
    less.boundingBox(),
    more.boundingBox(),
  ]);
  expect(lessBox).not.toBeNull();
  expect(moreBox).not.toBeNull();
  expect(Math.abs(lessBox!.y - moreBox!.y)).toBeLessThan(4);
  expect(lessBox!.height).toBeGreaterThanOrEqual(40);
  expect(moreBox!.height).toBeGreaterThanOrEqual(40);
  expect(
    await page
      .getByRole("heading", { name: "سبد شما" })
      .evaluate((element) => element.getBoundingClientRect().top),
  ).toBeLessThan(120);
  await assertNoHorizontalOverflow(page);
  await assertInteractiveTargets(page);
  await assertMinimumContrast(page.locator("main button, main a"));
  await more.focus();
  await expect(more).toBeFocused();
  expect(
    await more.evaluate((element) => getComputedStyle(element).outlineStyle),
  ).not.toBe("none");
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(
    await more.evaluate((element) =>
      Number.parseFloat(getComputedStyle(element).transitionDuration),
    ),
  ).toBeLessThan(0.001);

  await more.click();
  await expect(page.getByText("تعداد ۳")).toBeVisible();
  await expect(page.getByText("۱٬۳۵۰٬۰۰۰ تومان")).toHaveCount(3);
  await page.getByRole("button", { name: "حذف فنجان سرامیکی" }).click();
  await expect(page.getByText("سبد شما خالی است.", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "ادامه برای ثبت سفارش" })).toHaveCount(
    0,
  );
  await expect(page.getByRole("link", { name: "دیدن کالاها" })).toBeVisible();
});
