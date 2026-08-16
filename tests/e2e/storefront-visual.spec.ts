import { expect, test } from "@playwright/test";

import { contrastRatio } from "../helpers/color-contrast";

const visualFixtures = [
  "fixture-loading",
  "fixture-empty",
  "fixture-short",
  "fixture-long",
  "fixture-error",
  "fixture-custom",
] as const;

test("a guest can read the default empty storefront without signing in", async ({
  page,
}) => {
  const externalRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).hostname !== "127.0.0.1") {
      externalRequests.push(request.url());
    }
  });

  await page.goto("/s/fixture-empty");

  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("heading", { name: "فروشگاه سپیدار" })).toBeVisible();
  await expect(page.getByText("هنوز کالایی منتشر نشده")).toBeVisible();
  await expect(page.getByText("تسویه مستقیم")).toBeVisible();
  await expect(page.getByText(/تأیید آزمایشی/)).toBeVisible();
  await expect(page.getByText("ساخته‌شده با سوو")).toBeVisible();
  expect(externalRequests).toEqual([]);
});

test("stable fixtures explain loading and server failure states", async ({ page }) => {
  await page.goto("/s/fixture-loading");
  await expect(page.getByRole("status")).toHaveAttribute("aria-busy", "true");
  await expect(page.getByText("در حال آماده‌کردن فروشگاه")).toBeVisible();
  await expect(page.getByLabel("اطلاعات اعتماد")).toBeVisible();
  await expect(page.getByText("ساخته‌شده با سوو")).toBeVisible();

  await page.goto("/s/fixture-error");
  await expect(page.locator('section[role="alert"]')).toContainText("فروشگاه باز نشد");
  await expect(page.getByRole("link", { name: "دوباره تلاش کنید" })).toBeVisible();
  await expect(page.getByText("اطلاعات اعتماد فعلاً در دسترس نیست")).toBeVisible();
  await expect(page.getByText("ساخته‌شده با سوو")).toBeVisible();
});

test("refresh is stable and retry can recover from an error", async ({ page }) => {
  await page.goto("/s/fixture-short");
  await page.reload();
  await expect(page.getByRole("heading", { name: "خانه سرو" })).toBeVisible();

  await page.goto("/s/fixture-error");
  await page.getByRole("link", { name: "دوباره تلاش کنید" }).click();
  await expect(page.getByRole("heading", { name: "خانه سرو" })).toBeVisible();
});

test("an unpublished storefront is not exposed on its public route", async ({
  page,
}) => {
  const response = await page.goto("/s/fixture-unpublished");

  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "فروشگاه پیدا نشد" })).toBeVisible();
  await expect(page.getByText("فروشگاه سپیدار")).toHaveCount(0);
});

test("short, long, and customized identities keep purchase terms visible", async ({
  page,
}) => {
  for (const fixture of [
    { slug: "fixture-short", heading: "خانه سرو" },
    {
      slug: "fixture-long",
      heading: "فروشگاه دست‌سازه‌های کوچک و دوست‌داشتنی ماه‌نقره‌ای تهران",
    },
    { slug: "fixture-custom", heading: "استودیو زرشک" },
  ]) {
    await page.goto(`/s/${fixture.slug}`);

    await expect(page.getByRole("heading", { name: fixture.heading })).toBeVisible();
    await expect(page.getByText("ارسال با پست پیشتاز")).toBeVisible();
    await expect(page.getByText("تا ۷ روز پس از تحویل")).toBeVisible();
    await expect(page.getByText("تسویه مستقیم")).toBeVisible();
    await expect(page.getByText(/تأیید آزمایشی/)).toBeVisible();
    await expect(page.getByText("ساخته‌شده با سوو")).toBeVisible();
  }

  await page.goto("/s/fixture-long");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("keyboard order, focus, and interactive targets stay usable", async ({ page }) => {
  await page.goto("/s/fixture-short");

  await page.keyboard.press("Tab");
  const skipLink = page.getByRole("link", { name: "رفتن به محتوای فروشگاه" });
  await expect(skipLink).toBeFocused();
  await expect(skipLink).toHaveCSS("opacity", "1");

  await page.keyboard.press("Enter");
  await expect(page.locator("main")).toBeFocused();

  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "رفتن به صفحه اصلی سوو" })).toBeFocused();

  const targets = await page.locator("a").evaluateAll((links) =>
    links.map((link) => {
      const rect = link.getBoundingClientRect();
      return { name: link.textContent?.trim(), height: rect.height, width: rect.width };
    }),
  );
  for (const target of targets) {
    expect(
      target.height,
      `${target.name} must be at least 40px tall`,
    ).toBeGreaterThanOrEqual(40);
    expect(
      target.width,
      `${target.name} must be at least 40px wide`,
    ).toBeGreaterThanOrEqual(40);
  }
});

test("the storefront reflows without clipping at an effective 200% zoom", async ({
  page,
}, testInfo) => {
  const configuredViewport = testInfo.project.use.viewport;
  if (!configuredViewport) {
    throw new Error("The visual project must declare a viewport");
  }
  await page.setViewportSize({
    width: Math.floor(configuredViewport.width / 2),
    height: Math.floor(configuredViewport.height / 2),
  });
  await page.goto("/s/fixture-long");

  expect(await page.evaluate(() => window.innerWidth * 2)).toBe(
    configuredViewport.width,
  );
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("region", { name: "پیش از سفارش بدانید" })).toBeVisible();
  await expect(page.getByText("ساخته‌شده با سوو")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("essential text and actions meet minimum contrast", async ({ page }) => {
  await page.goto("/s/fixture-error");

  const samples = await page
    .getByRole("heading", { name: "فروشگاه باز نشد" })
    .or(page.getByRole("link", { name: "دوباره تلاش کنید" }))
    .evaluateAll((elements) =>
      elements.map((element) => {
        const style = getComputedStyle(element);
        let background = style.backgroundColor;
        let ancestor = element.parentElement;
        while (background === "rgba(0, 0, 0, 0)" && ancestor) {
          background = getComputedStyle(ancestor).backgroundColor;
          ancestor = ancestor.parentElement;
        }
        return {
          foreground: style.color,
          background,
        };
      }),
    );

  for (const sample of samples) {
    expect(contrastRatio(sample.foreground, sample.background)).toBeGreaterThanOrEqual(
      4.5,
    );
  }
});

test("motion is useful when allowed and removed when reduced", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/s/fixture-short");
  const badge = page.getByRole("link", { name: "رفتن به صفحه اصلی سوو" });
  expect(
    await badge.evaluate((element) => getComputedStyle(element).transitionDuration),
  ).not.toBe("0s");

  await page.emulateMedia({ reducedMotion: "reduce" });
  const reducedDuration = await badge.evaluate((element) =>
    Number.parseFloat(getComputedStyle(element).transitionDuration),
  );
  expect(reducedDuration).toBeLessThanOrEqual(0.00001);
});

for (const slug of visualFixtures) {
  test(`${slug} has a deterministic visual baseline`, async ({ page }) => {
    const externalRequests: string[] = [];
    page.on("request", (request) => {
      if (new URL(request.url()).hostname !== "127.0.0.1") {
        externalRequests.push(request.url());
      }
    });

    await page.goto(`/s/${slug}`);
    await expect(page.locator("main")).toBeVisible();
    await expect(page).toHaveScreenshot(`${slug}.png`, {
      animations: "disabled",
      fullPage: true,
      maxDiffPixels: 0,
    });
    expect(externalRequests).toEqual([]);
  });
}
