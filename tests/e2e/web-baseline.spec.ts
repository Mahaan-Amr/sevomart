import { expect, test } from "@playwright/test";
import { discoveryV1Examples } from "@sevo/contracts/discovery/v1";
import { ordersV1Examples } from "@sevo/contracts/orders/v1";

import {
  assertMinimumContrast,
  assertNoHorizontalOverflow,
  assertInteractiveTargets,
} from "../helpers/visual-assertions";

test("the web baseline is Persian, accessible, and right-to-left", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");

  await expect(page.locator("html")).toHaveAttribute("lang", "fa");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("heading", { name: "کشف تازه‌ها" })).toBeVisible();
  const navigation = page.getByRole("navigation", { name: "فضای خریدار" });
  await expect(
    navigation.getByRole("link", { name: "کشف", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await expect(navigation.getByRole("link", { name: "سبد" })).toHaveCount(0);
  await expect(
    page.getByRole("banner").getByRole("link", { name: "سبد" }),
  ).toBeVisible();
  for (const destination of ["دنبال‌شده‌ها", "سفارش‌ها", "گفت‌وگوها"]) {
    await expect(navigation.getByRole("link", { name: destination })).toHaveCount(0);
  }
  await assertNoHorizontalOverflow(page);
  await assertInteractiveTargets(page, "header a, nav a, summary");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "رفتن به محتوای صفحه" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("main")).toBeFocused();

  expect(
    await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches),
  ).toBe(true);
  expect(
    await page.evaluate(() =>
      Array.from(document.styleSheets).some((sheet) =>
        Array.from(sheet.cssRules).some((rule) =>
          rule.cssText.includes("prefers-reduced-motion: reduce"),
        ),
      ),
    ),
  ).toBe(true);
  expect(await page.evaluate(() => document.fonts.check('16px "Yekan Bakh"'))).toBe(
    true,
  );

  await assertMinimumContrast(page.locator("h1, main p, nav a"));
});

test("discovery renders public feed data and recovers from a failed request", async ({
  page,
}) => {
  let fail = true;
  await page.route("**/api/discovery*", async (route) => {
    await route.fulfill({
      status: fail ? 503 : 200,
      json: fail
        ? { code: "PROJECTION_UNAVAILABLE" }
        : {
            ...discoveryV1Examples.DiscoveryFeedPageV1,
            emptyState: undefined,
            items: [discoveryV1Examples.DiscoveryFeedItemV1],
          },
    });
  });
  await page.goto("/");
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "کالاها بارگیری نشدند",
  );
  fail = false;
  await page.getByRole("button", { name: "تلاش دوباره" }).click();
  await expect(page.getByRole("list", { name: "کالاهای تازه" })).toBeVisible();
  await expect(page.getByRole("link", { name: /فنجان دست‌ساز/ })).toHaveAttribute(
    "href",
    /\/s\/khane-sofal\/products\/0d113616/,
  );
});

test("legacy addresses preserve the checkout return destination through login", async ({
  page,
}) => {
  await page.route("**/api/addresses", (route) =>
    route.fulfill({ status: 401, json: {} }),
  );
  await page.goto("/addresses?returnTo=%2Fcheckout%2Fdelivery");
  await expect(page).toHaveURL(/\/login\?/);
  const login = new URL(page.url());
  expect(login.searchParams.get("returnTo")).toBe(
    "/account/addresses?returnTo=%2Fcheckout%2Fdelivery",
  );
  await expect(
    page.getByRole("link", { name: "انصراف و بازگشت", exact: true }),
  ).toHaveAttribute("href", "/checkout/delivery");
});

test("checkout's legacy entry resumes at delivery and keeps login contextual", async ({
  page,
}) => {
  await page.route("**/api/checkout/options", (route) =>
    route.fulfill({ status: 401, json: {} }),
  );
  await page.goto("/checkout");
  await expect(page).toHaveURL(/\/login\?/);
  expect(new URL(page.url()).searchParams.get("returnTo")).toBe("/checkout/delivery");
  await expect(
    page.getByRole("link", { name: "انصراف و بازگشت", exact: true }),
  ).toHaveAttribute("href", "/cart");
});

test("delivery and review have separate URLs and refresh requires a fresh review", async ({
  page,
}) => {
  await page.route("**/api/checkout/options", (route) =>
    route.fulfill({ json: ordersV1Examples.CheckoutOptions }),
  );
  await page.route("**/api/checkout/prepare", (route) =>
    route.fulfill({ json: ordersV1Examples.CheckoutPreparation }),
  );
  await page.goto("/checkout/delivery");
  await expect(page.getByRole("heading", { name: "تحویل سفارش" })).toBeVisible();
  await page.getByRole("button", { name: "دیدن مبلغ نهایی" }).click();
  await expect(page).toHaveURL(/\/checkout\/review$/);
  await expect(page.getByRole("heading", { name: "مرور نهایی سفارش" })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("group", { name: "روش ارسال" })).toBeVisible();
  await page.goForward();
  await expect(page.getByRole("heading", { name: "تسویه مستقیم" })).toBeVisible();
  await page.reload();
  await expect(page).toHaveURL(/\/checkout\/delivery$/);
  await expect(page.getByRole("group", { name: "روش ارسال" })).toBeVisible();
});

test("old payment receipts redirect to their canonical result with a usable way back", async ({
  page,
}) => {
  const orderId = "47a3f408-858c-45d7-a0bd-ab84a28718ef";
  const attemptId = "6070faec-78f8-4a5f-86da-cdd19b39c5a3";
  await page.route("**/api/payment-attempts/*", (route) =>
    route.fulfill({ status: 404, json: {} }),
  );
  await page.goto(`/orders/${orderId}?attemptId=${attemptId}`);
  await expect(page).toHaveURL(
    new RegExp(`/orders/${orderId}/payment-result\\?attemptId=${attemptId}$`),
  );
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "رسید در دسترس نیست",
  );
  await page.getByRole("link", { name: "بازگشت به سبد" }).click();
  await expect(page).toHaveURL(/\/cart$/);
});

test("unknown and retired prototype routes provide Persian recovery without demo content", async ({
  page,
}) => {
  for (const path of ["/not-a-sevo-page", "/prototype/discovery", "/orders"]) {
    const response = await page.goto(path);
    expect(response?.status()).toBe(404);
    await expect(
      page.getByRole("heading", { name: "این صفحه پیدا نشد" }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "بازگشت به کشف" })).toHaveAttribute(
      "href",
      "/",
    );
  }
});

test("editing addresses returns to the selected delivery method without putting private fields in the URL", async ({
  page,
}) => {
  const shipping = {
    ...ordersV1Examples.CheckoutOptions.shippingMethods[0],
    id: "be77af55-ce97-46d5-8540-b5d55652daf2",
    label: "پیک",
  };
  await page.route("**/api/checkout/options", (route) =>
    route.fulfill({
      json: {
        ...ordersV1Examples.CheckoutOptions,
        shippingMethods: [
          ...ordersV1Examples.CheckoutOptions.shippingMethods,
          shipping,
        ],
      },
    }),
  );
  await page.route("**/api/addresses", (route) =>
    route.fulfill({ json: { addresses: ordersV1Examples.CheckoutOptions.addresses } }),
  );
  await page.goto("/checkout/delivery");
  await page.getByRole("radio", { name: /پیک/ }).check();
  await page.getByRole("link", { name: "افزودن یا ویرایش نشانی" }).click();
  expect(decodeURIComponent(page.url())).not.toContain("09123456789");
  expect(decodeURIComponent(page.url())).not.toContain("سارا");
  await page.getByRole("link", { name: "بازگشت به تحویل سفارش" }).click();
  await expect(page.getByRole("radio", { name: /پیک/ })).toBeChecked();
});

test("identity login preserves the current discovery cursor", async ({ page }) => {
  await page.goto("/?cursor=resume-feed");
  await page.getByText("هویت سوو", { exact: true }).click();
  await page.getByRole("link", { name: "ورود و ادامه" }).click();
  await expect(page).toHaveURL(/\/login\?/);
  expect(new URL(page.url()).searchParams.get("returnTo")).toBe("/?cursor=resume-feed");
  await expect(
    page.getByRole("link", { name: "انصراف و بازگشت", exact: true }),
  ).toHaveAttribute("href", "/?cursor=resume-feed");
});

test("discovery keeps three columns with long Persian text and follows its cursor to an empty page", async ({
  page,
}, testInfo) => {
  const item = discoveryV1Examples.DiscoveryFeedItemV1;
  await page.route("**/api/store/media/*", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><rect width="300" height="300" fill="#F6E3E9"/><path d="M80 100h110v70a45 45 0 0 1-110 0zM190 115h15a25 25 0 0 1 0 50h-15" fill="none" stroke="#A41439" stroke-width="8"/></svg>',
    }),
  );
  await page.route("**/api/discovery*", (route) =>
    route.fulfill({
      json: route.request().url().includes("cursor=next-page")
        ? discoveryV1Examples.DiscoveryFeedPageV1
        : {
            ...discoveryV1Examples.DiscoveryFeedPageV1,
            emptyState: undefined,
            nextCursor: "next-page",
            items: ["1", "2", "3"].map((suffix) => ({
              ...item,
              productId: `0d113616-5ad8-45d2-a126-b5b3412b3dd${suffix}`,
              product: {
                ...item.product,
                name: "فنجان سرامیکی دست‌ساز با نقش‌های ظریف و رنگ‌های گرم برای نوشیدنی‌های روزانه",
              },
              store: {
                ...item.store,
                name: "خانه سفال و دست‌ساخته‌های هنرمندان ایرانی",
              },
            })),
          },
    }),
  );
  await page.goto("/");
  const cards = page.getByRole("list", { name: "کالاهای تازه" }).getByRole("listitem");
  await expect(cards).toHaveCount(3);
  const tops = await cards.evaluateAll((elements) =>
    elements.map((element) => element.getBoundingClientRect().top),
  );
  expect(new Set(tops).size).toBe(1);
  await assertNoHorizontalOverflow(page);
  await assertMinimumContrast(page.locator("main h2, main strong, main span"));
  await page.screenshot({
    path: testInfo.outputPath("buyer-discovery.png"),
    fullPage: true,
  });
  await page.getByRole("link", { name: "کالاهای بعدی" }).click();
  await expect(page).toHaveURL(/\?cursor=next-page$/);
  await expect(page.getByText("فعلاً کالایی برای دیدن نیست.")).toBeVisible();
  await page.getByRole("link", { name: "بازگشت به کشف", exact: true }).click();
  await expect(cards).toHaveCount(3);
});
