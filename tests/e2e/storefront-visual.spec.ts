import { expect, request as createRequest, test } from "@playwright/test";
import postgres from "postgres";
import sharp from "sharp";

import { contrastRatio } from "../helpers/color-contrast";

const apiBaseUrl = "http://127.0.0.1:3109";
const databaseUrl =
  process.env.DATABASE_URL ?? "postgresql://sevo:sevo_local@localhost:6432/sevo";
const projectIndexes: Record<string, number> = {
  "chromium-360x800": 0,
  "chromium-390x844": 1,
  "chromium-768x1024": 2,
  "chromium-1440x900": 3,
};
type ProjectStores = {
  defaultSlug: string;
  customSlug: string;
  draftSlug: string;
};

let stores: ProjectStores;

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browserName }, testInfo) => {
  if (browserName !== "chromium") {
    throw new Error(`Unsupported browser ${browserName}`);
  }
  const index = projectIndexes[testInfo.project.name];
  if (index === undefined) throw new Error(`Unknown project ${testInfo.project.name}`);

  stores = {
    defaultSlug: `e2e-${index}-default`,
    customSlug: `e2e-${index}-custom`,
    draftSlug: `e2e-${index}-draft`,
  };
  const mobiles = [mobileFor(index * 2), mobileFor(index * 2 + 1)];
  const sql = postgres(databaseUrl, { max: 1 });
  await sql`
    delete from store_stores
    where slug in (${stores.defaultSlug}, ${stores.customSlug}, ${stores.draftSlug})
       or id in (
         select membership.store_id
         from store_memberships membership
         join identity_sellers seller on seller.id = membership.seller_id
         where seller.mobile in ${sql(mobiles)}
       )
  `;
  await sql`
    insert into store_stores (id, name, slug, status)
    values (${crypto.randomUUID()}, ${"پیش‌نویس خصوصی"}, ${stores.draftSlug}, ${"DRAFT"})
  `;
  await sql.end();

  await createStore(mobiles[0]!, stores.defaultSlug, false);
  await createStore(mobiles[1]!, stores.customSlug, true);
});

test("a guest reads a published empty storefront from the real API", async ({
  page,
}) => {
  const externalRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).hostname !== "127.0.0.1") {
      externalRequests.push(request.url());
    }
  });

  await page.goto(`/s/${stores.defaultSlug}`);

  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("heading", { name: "خانه سرو" })).toBeVisible();
  await expect(page.getByText("هنوز کالایی منتشر نشده")).toBeVisible();
  await expect(page.getByText("پست پیشتاز، دریافت حضوری")).toBeVisible();
  await expect(page.getByText("تسویه مستقیم")).toBeVisible();
  await expect(page.getByText(/تأیید آزمایشی/)).toBeVisible();
  await expect(page.getByText("ساخته‌شده با سوو")).toBeVisible();
  expect(externalRequests).toEqual([]);
});

test("draft and unknown slugs expose no private store data", async ({ page }) => {
  for (const slug of [stores.draftSlug, `unknown-${stores.draftSlug}`]) {
    const response = await page.goto(`/s/${slug}`);
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "فروشگاه پیدا نشد" })).toBeVisible();
    await expect(page.getByText("پیش‌نویس خصوصی")).toHaveCount(0);
  }
});

test("custom media, theme and long Persian content render with API media", async ({
  page,
}) => {
  await page.goto(`/s/${stores.customSlug}`);

  await expect(
    page.getByRole("heading", {
      name: "فروشگاه دست‌سازه‌های کوچک و دوست‌داشتنی ماه‌نقره‌ای تهران",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("img", { name: /نشان فروشگاه دست‌سازه‌ها/ }),
  ).toBeVisible();
  await expect(page.locator("header img")).toHaveCount(2);
  await expect(
    page.getByText("تا هفت روز پس از تحویل امکان درخواست مرجوعی وجود دارد."),
  ).toBeVisible();
  await expect(page.getByText("ساخته‌شده با سوو")).toBeVisible();
  await expect(page.locator("header")).toHaveCSS("--store-accent", "#760B29");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("refresh reads the published store from the API again", async ({ page }) => {
  await page.goto(`/s/${stores.defaultSlug}`);
  await page.reload();

  await expect(page.getByRole("heading", { name: "خانه سرو" })).toBeVisible();
});

test("test-only states explain loading and server failure", async ({ page }) => {
  await page.goto("/s/test-loading");
  await expect(page.getByRole("status")).toHaveAttribute("aria-busy", "true");
  await expect(page.getByLabel("اطلاعات اعتماد")).toBeVisible();

  await page.goto("/s/test-error");
  await expect(page.locator('section[role="alert"]')).toContainText("فروشگاه باز نشد");
  await expect(page.getByRole("link", { name: "دوباره تلاش کنید" })).toBeVisible();
  await expect(page.getByText("اطلاعات اعتماد فعلاً در دسترس نیست")).toBeVisible();
});

test("keyboard order, focus, and interactive targets stay usable", async ({ page }) => {
  await page.goto(`/s/${stores.defaultSlug}`);

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
  const viewport = testInfo.project.use.viewport;
  if (!viewport) throw new Error("The visual project must declare a viewport");
  await page.setViewportSize({
    width: Math.floor(viewport.width / 2),
    height: Math.floor(viewport.height / 2),
  });
  await page.goto(`/s/${stores.customSlug}`);

  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("region", { name: "پیش از سفارش بدانید" })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("essential text and actions meet minimum contrast", async ({ page }) => {
  await page.goto("/s/test-error");
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
        return { foreground: style.color, background };
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
  await page.goto(`/s/${stores.defaultSlug}`);
  const badge = page.getByRole("link", { name: "رفتن به صفحه اصلی سوو" });
  expect(
    await badge.evaluate((element) => getComputedStyle(element).transitionDuration),
  ).not.toBe("0s");

  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(
    await badge.evaluate((element) =>
      Number.parseFloat(getComputedStyle(element).transitionDuration),
    ),
  ).toBeLessThanOrEqual(0.00001);
});

for (const state of ["default", "custom", "loading", "error"] as const) {
  test(`${state} has a deterministic visual baseline`, async ({ page }) => {
    const path =
      state === "default"
        ? `/s/${stores.defaultSlug}`
        : state === "custom"
          ? `/s/${stores.customSlug}`
          : `/s/test-${state}`;
    await page.goto(path);
    await expect(page.locator("main")).toBeVisible();
    await expect(page).toHaveScreenshot(`storefront-${state}.png`, {
      animations: "disabled",
      fullPage: true,
      maxDiffPixelRatio: 0.015,
    });
  });
}

function mobileFor(offset: number) {
  return `09111111${String(20 + offset).padStart(3, "0")}`;
}

async function createStore(mobile: string, slug: string, customized: boolean) {
  const context = await createRequest.newContext({ baseURL: apiBaseUrl });
  const challengeResponse = await context.post("/v1/auth/otp/requests", {
    data: { mobile },
  });
  expect(challengeResponse.status()).toBe(202);
  const challenge = (await challengeResponse.json()) as { challengeId: string };
  const verification = await context.post("/v1/auth/otp/verifications", {
    data: { challengeId: challenge.challengeId, code: "111111" },
  });
  expect(verification.ok()).toBe(true);

  let logoMediaId: string | null = null;
  let coverMediaId: string | null = null;
  if (customized) {
    logoMediaId = (await uploadImage(context, "logo.png", "STORE_LOGO")).id;
    coverMediaId = (await uploadImage(context, "cover.png", "STORE_COVER")).id;
  }

  const draft = await context.put("/v1/seller/store/draft", {
    data: {
      name: customized
        ? "فروشگاه دست‌سازه‌های کوچک و دوست‌داشتنی ماه‌نقره‌ای تهران"
        : "خانه سرو",
      slug,
      bio: customized
        ? "اینجا هر دست‌سازه با حوصله و در شمار محدود آماده می‌شود؛ توضیح روشن کمک می‌کند پیش از سفارش بدانید چه چیزی به دستتان می‌رسد."
        : "چیزهای کوچک و کاربردی برای خانه.",
      shippingMethods: [
        { code: "NATIONAL_POST", label: "پست پیشتاز" },
        { code: "PICKUP", label: "دریافت حضوری" },
      ],
      returnPolicy: "تا هفت روز پس از تحویل امکان درخواست مرجوعی وجود دارد.",
      settlementDestination: { kind: "TEST" },
      logoMediaId,
      coverMediaId,
      themeColor: customized ? "#760B29" : "#A41439",
    },
  });
  expect(draft.ok()).toBe(true);
  const publication = await context.post("/v1/seller/store/publication");
  expect(publication.ok()).toBe(true);
  await context.dispose();
}

async function uploadImage(
  context: Awaited<ReturnType<typeof createRequest.newContext>>,
  fileName: string,
  purpose: "STORE_LOGO" | "STORE_COVER",
) {
  const image = await sharp({
    create:
      purpose === "STORE_LOGO"
        ? { width: 256, height: 256, channels: 4, background: "#760B29" }
        : { width: 1200, height: 400, channels: 4, background: "#EEC8D3" },
  })
    .png()
    .toBuffer();
  const response = await context.post("/v1/seller/media", {
    multipart: {
      purpose,
      file: {
        name: fileName,
        mimeType: "image/png",
        buffer: image,
      },
    },
  });
  expect(response.ok()).toBe(true);
  return (await response.json()) as { id: string };
}
