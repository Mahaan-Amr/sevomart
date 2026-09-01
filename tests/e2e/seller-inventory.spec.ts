import { randomUUID } from "node:crypto";

import { expect, test } from "../helpers/release-playwright";
import postgres from "postgres";

import {
  assertInteractiveTargets,
  assertMinimumContrast,
  assertNoHorizontalOverflow,
} from "../helpers/visual-assertions";
import {
  sellerInventoryTestMobiles,
  visualProjectIndex,
} from "../helpers/visual-projects";

test("seller finds variants and safely adjusts inventory with Persian numbers", async ({
  page,
}, testInfo) => {
  const projectIndex = visualProjectIndex(testInfo.project.name);
  const mobile = sellerInventoryTestMobiles[projectIndex]!;
  const databaseUrl =
    process.env.DATABASE_URL ?? "postgresql://sevo:sevo_local@localhost:6432/sevo";
  const ids = {
    store: randomUUID(),
    product: randomUUID(),
    red: randomUUID(),
    blue: randomUUID(),
    media: randomUUID(),
    simpleProduct: randomUUID(),
    simpleVariant: randomUUID(),
    simpleMedia: randomUUID(),
  };
  const longProductName =
    "کیف روزمره دست‌دوز چرمی با بند قابل تنظیم برای استفاده روزانه و سفرهای کوتاه شهری";
  const simpleProductName = "دفتر برنامه‌ریزی ساده برای یادداشت کارهای روزانه";
  const blueLabel =
    "رنگ رویه بسیار بادوام: آبی آسمانی روشن، اندازه مناسب استفاده: بزرگ جادار";
  const redLabel =
    "رنگ رویه بسیار بادوام: قرمز گرم، اندازه مناسب استفاده: کوچک جمع‌وجور";

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/seller/login?returnTo=%2Fseller%2Finventory");
  await page.getByLabel("شماره موبایل").fill(mobile);
  await page.getByRole("button", { name: "دریافت کد" }).click();
  await page.getByLabel("کد شش‌رقمی").fill("111111");
  await page.getByRole("button", { name: "ورود" }).click();
  await expect(page.getByRole("link", { name: "ادامه کار" })).toBeVisible();

  const sql = postgres(databaseUrl, { max: 1 });
  try {
    const identities = await sql<Array<{ identityId: string }>>`
      select identity_id as "identityId" from identity_login_methods
      where mobile = ${mobile}
    `;
    const identityId = identities[0]!.identityId;
    await sql`
      insert into identity_seller_access (id, identity_id, status)
      values (${randomUUID()}, ${identityId}::uuid, 'ACTIVE')
      on conflict (identity_id) do update set status = 'ACTIVE'
    `;
    await sql`
      delete from store_stores where id in (
        select store_id from store_memberships where seller_id = ${identityId}::uuid
      )
    `;
    await sql`
      insert into store_stores
        (id, name, slug, bio, return_policy, return_policy_revision,
         settlement_kind, settlement_status, settlement_verified_at,
         theme_color, status, published_at, publication_version, revision)
      values
        (${ids.store}, 'خانه کیف', ${`inventory-${projectIndex}`}, 'کیف دست‌دوز',
         'تا هفت روز امکان درخواست مرجوعی وجود دارد.', 1,
         'TEST', 'TEST_VERIFIED', now(), '#A41439', 'PUBLISHED', now(), 1, 1)
    `;
    await sql`
      insert into store_shipping_methods
        (id, store_id, position, code, label, revision, fixed_fee_amount,
         currency, estimated_delivery_text, enabled,
         requires_delivery_address, requires_postal_code)
      values (${randomUUID()}, ${ids.store}, 0, 'NATIONAL_POST', 'پست پیشتاز',
        1, 0, 'IRR', '۲ تا ۴ روز کاری', true, true, true)
    `;
    await sql`
      insert into store_memberships (id, store_id, seller_id, role)
      values (${randomUUID()}, ${ids.store}, ${identityId}, 'OWNER')
    `;
    await sql`
      insert into product_products
        (id, store_id, state, revision, publication_version, published_at)
      values (${ids.product}, ${ids.store}, 'PUBLISHED', 3, 1, now())
    `;
    await sql`
      insert into product_variants
        (id, product_id, store_id, client_key, combination_key, retired,
         ever_published)
      values
        (${ids.red}, ${ids.product}, ${ids.store}, 'red-small',
         'color:red|size:small', false, true),
        (${ids.blue}, ${ids.product}, ${ids.store}, 'blue-large',
         'color:blue|size:large', false, true)
    `;
    const axes = [
      {
        clientKey: "color",
        name: "رنگ رویه بسیار بادوام",
        values: [
          { clientKey: "red", name: "قرمز گرم" },
          { clientKey: "blue", name: "آبی آسمانی روشن" },
        ],
      },
      {
        clientKey: "size",
        name: "اندازه مناسب استفاده",
        values: [
          { clientKey: "small", name: "کوچک جمع‌وجور" },
          { clientKey: "large", name: "بزرگ جادار" },
        ],
      },
    ];
    const variants = [
      {
        clientKey: "red-small",
        variantId: ids.red,
        combination: [
          { axisClientKey: "color", valueClientKey: "red" },
          { axisClientKey: "size", valueClientKey: "small" },
        ],
      },
      {
        clientKey: "blue-large",
        variantId: ids.blue,
        combination: [
          { axisClientKey: "color", valueClientKey: "blue" },
          { axisClientKey: "size", valueClientKey: "large" },
        ],
      },
    ];
    const definition = {
      name: longProductName,
      description: "کیف سبک برای استفاده روزانه",
      orderedMediaIds: [ids.media],
      axes: axes.map((axis) => ({
        ...axis,
        values: axis.values.map((value) =>
          value.clientKey === "blue"
            ? { ...value, name: "فیروزه‌ای ویرایش‌شده اما منتشرنشده" }
            : value,
        ),
      })),
      variants,
    };
    const snapshot = {
      productId: ids.product,
      name: longProductName,
      description: "کیف سبک برای استفاده روزانه",
      images: [{ id: ids.media, url: `/v1/media/${ids.media}` }],
      axes: axes.map((axis) => ({
        name: axis.name,
        values: axis.values.map((value) => value.name),
      })),
      variants: [
        {
          variantId: ids.red,
          combination: [
            { axis: "رنگ رویه بسیار بادوام", value: "قرمز گرم" },
            { axis: "اندازه مناسب استفاده", value: "کوچک جمع‌وجور" },
          ],
          price: { amount: 4_500_000, currency: "IRR" },
          availability: "AVAILABLE",
        },
        {
          variantId: ids.blue,
          combination: [
            { axis: "رنگ رویه بسیار بادوام", value: "آبی آسمانی روشن" },
            { axis: "اندازه مناسب استفاده", value: "بزرگ جادار" },
          ],
          price: { amount: 4_800_000, currency: "IRR" },
          availability: "AVAILABLE",
        },
      ],
      priceRange: {
        minimum: { amount: 4_500_000, currency: "IRR" },
        maximum: { amount: 4_800_000, currency: "IRR" },
      },
      availability: "AVAILABLE",
      publicationVersion: 1,
    };
    await sql`
      insert into product_working_copies
        (product_id, name, description, media_id, variant_id, definition)
      values (${ids.product}, ${longProductName}, 'کیف سبک برای استفاده روزانه',
        ${ids.media}, ${ids.red}, ${sql.json(definition)})
    `;
    await sql`
      insert into product_publications
        (product_id, publication_version, name, description, media_id,
         variant_id, snapshot)
      values (${ids.product}, 1, ${longProductName}, 'کیف سبک برای استفاده روزانه',
        ${ids.media}, ${ids.red}, ${sql.json(snapshot)})
    `;
    await sql`
      insert into product_offers
        (product_id, variant_id, amount, currency, revision)
      values
        (${ids.product}, ${ids.red}, 4500000, 'IRR', 1),
        (${ids.product}, ${ids.blue}, 4800000, 'IRR', 1)
    `;
    await sql`
      insert into inventory_levels (variant_id, store_id, on_hand, revision)
      values
        (${ids.red}, ${ids.store}, 2, 1),
        (${ids.blue}, ${ids.store}, 8, 1)
    `;

    const simpleDefinition = {
      name: simpleProductName,
      description: "دفتر ساده و دسته‌خنثی",
      orderedMediaIds: [ids.simpleMedia],
      axes: [],
      variants: [
        { clientKey: "simple", variantId: ids.simpleVariant, combination: [] },
      ],
    };
    const simpleSnapshot = {
      productId: ids.simpleProduct,
      name: simpleProductName,
      description: "دفتر ساده و دسته‌خنثی",
      images: [{ id: ids.simpleMedia, url: `/v1/media/${ids.simpleMedia}` }],
      axes: [],
      variants: [
        {
          variantId: ids.simpleVariant,
          combination: [],
          price: { amount: 1_200_000, currency: "IRR" },
          availability: "OUT_OF_STOCK",
        },
      ],
      priceRange: {
        minimum: { amount: 1_200_000, currency: "IRR" },
        maximum: { amount: 1_200_000, currency: "IRR" },
      },
      availability: "OUT_OF_STOCK",
      publicationVersion: 1,
    };
    await sql`
      insert into product_products
        (id, store_id, state, revision, publication_version, published_at)
      values (${ids.simpleProduct}, ${ids.store}, 'PUBLISHED', 2, 1, now())
    `;
    await sql`
      insert into product_variants
        (id, product_id, store_id, client_key, combination_key, retired,
         ever_published)
      values (${ids.simpleVariant}, ${ids.simpleProduct}, ${ids.store}, 'simple',
        'simple', false, true)
    `;
    await sql`
      insert into product_working_copies
        (product_id, name, description, media_id, variant_id, definition)
      values (${ids.simpleProduct}, ${simpleProductName},
        'دفتر ساده و دسته‌خنثی', ${ids.simpleMedia}, ${ids.simpleVariant},
        ${sql.json(simpleDefinition)})
    `;
    await sql`
      insert into product_publications
        (product_id, publication_version, name, description, media_id,
         variant_id, snapshot)
      values (${ids.simpleProduct}, 1, ${simpleProductName},
        'دفتر ساده و دسته‌خنثی', ${ids.simpleMedia}, ${ids.simpleVariant},
        ${sql.json(simpleSnapshot)})
    `;
    await sql`
      insert into product_offers
        (product_id, variant_id, amount, currency, revision)
      values (${ids.simpleProduct}, ${ids.simpleVariant}, 1200000, 'IRR', 1)
    `;
    await sql`
      insert into inventory_levels (variant_id, store_id, on_hand, revision)
      values (${ids.simpleVariant}, ${ids.store}, 0, 1)
    `;

    await page.goto("/seller/inventory");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(
      page.getByRole("heading", { name: "اصلاح موجودی گونه‌ها" }),
    ).toBeVisible();
    const reducedMotion = await page.locator("main").evaluate((main) => {
      const firstAction = main.querySelector("button");
      const duration = firstAction
        ? getComputedStyle(firstAction).transitionDuration
        : "0s";
      const durationMs = duration.endsWith("ms")
        ? Number.parseFloat(duration)
        : Number.parseFloat(duration) * 1_000;
      return {
        requested: matchMedia("(prefers-reduced-motion: reduce)").matches,
        durationMs,
      };
    });
    expect(reducedMotion.requested).toBe(true);
    expect(reducedMotion.durationMs).toBeLessThanOrEqual(0.01);
    await assertMinimumContrast(
      page.getByRole("heading", { name: "اصلاح موجودی گونه‌ها" }),
    );
    await expect(page.getByText(blueLabel)).toBeVisible();
    await expect(page.getByText("فیروزه‌ای ویرایش‌شده اما منتشرنشده")).toHaveCount(0);
    const search = page.getByLabel("جست‌وجوی نام کالا یا ویژگی گونه");
    await search.fill("دفتر برنامه‌ریزی");
    const simpleRow = page.getByRole("listitem").filter({ hasText: simpleProductName });
    await expect(simpleRow.getByText("گونه اصلی", { exact: true })).toBeVisible();
    await expect(simpleRow.getByText("ناموجود", { exact: true })).toBeVisible();
    const simpleIncrease = simpleRow.getByRole("button", { name: /افزایش موجودی/ });
    await search.focus();
    await page.keyboard.press("Tab");
    await expect(simpleIncrease).toBeFocused();
    expect(
      await simpleIncrease.evaluate((button) => {
        const style = getComputedStyle(button);
        return (
          style.outlineStyle !== "none" && Number.parseFloat(style.outlineWidth) >= 3
        );
      }),
    ).toBe(true);
    await page.keyboard.press("Enter");
    await expect(page.getByLabel("مقدار افزایش")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("دلیل تغییر")).toBeFocused();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "انصراف" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByLabel("مقدار افزایش")).toHaveCount(0);

    await search.fill("آبی بزرگ");
    const blueRow = page.getByRole("listitem").filter({ hasText: blueLabel });
    await expect(blueRow).toBeVisible();
    await expect(page.getByRole("listitem")).toHaveCount(1);
    await assertMinimumContrast(blueRow.getByText(longProductName));
    const writeKeys: string[] = [];
    page.on("request", (request) => {
      if (
        request.method() === "PUT" &&
        request.url().includes("/api/seller/inventory")
      ) {
        writeKeys.push(request.headers()["idempotency-key"] ?? "");
      }
    });
    let concealFirstWriteResponse = true;
    await page.route("**/api/seller/inventory", async (route) => {
      if (route.request().method() !== "PUT" || !concealFirstWriteResponse) {
        await route.continue();
        return;
      }
      concealFirstWriteResponse = false;
      await route.fetch();
      await route.abort("failed");
    });
    await blueRow.getByRole("button", { name: /افزایش موجودی/ }).focus();
    await page.keyboard.press("Enter");
    await page.getByLabel("مقدار افزایش").fill("۲");
    await page.getByLabel("دلیل تغییر").selectOption("RETURNED_TO_STOCK");
    await page.getByRole("button", { name: "ذخیره موجودی" }).click();
    await expect(page.locator("#inventory-editor-error")).toContainText(
      "نتیجه ثبت هنوز روشن نیست",
    );
    await expect(page.getByLabel("مقدار افزایش")).toBeDisabled();
    await expect(page.getByLabel("دلیل تغییر")).toBeDisabled();
    await expect(page.getByRole("button", { name: "انصراف" })).toBeDisabled();
    await page.unroute("**/api/seller/inventory");
    await page.getByRole("button", { name: "پیگیری همان درخواست" }).click();
    await expect(page.getByRole("status")).toContainText("ثبت شد");
    expect(writeKeys).toHaveLength(2);
    expect(writeKeys[1]).toBe(writeKeys[0]);
    await expect(
      blueRow
        .locator("dl div")
        .filter({ has: page.getByText("موجودی", { exact: true }) })
        .getByText("۱۰", { exact: true }),
    ).toBeVisible();

    await search.fill("قرمز کوچک");
    const redRow = page.getByRole("listitem").filter({ hasText: redLabel });
    await redRow.getByRole("button", { name: /اصلاح موجودی/ }).click();
    await page.getByLabel("موجودی شمارش‌شده").fill("۶");
    await page.getByLabel("دلیل تغییر").selectOption("CORRECTION");
    await sql`
      update inventory_levels set on_hand = 4, revision = 2
      where variant_id = ${ids.red}
    `;
    await page.getByRole("button", { name: "ذخیره موجودی" }).click();
    await expect(page.locator("#inventory-editor-error")).toContainText("اطلاعات تازه");
    await page.getByRole("button", { name: "گرفتن اطلاعات تازه" }).click();
    await expect(page.getByRole("status")).toContainText("موجودی تازه شد");

    await redRow.getByRole("button", { name: /کاهش موجودی/ }).click();
    await page.getByLabel("مقدار کاهش").fill("۵");
    await page.getByLabel("دلیل تغییر").selectOption("DAMAGED");
    await page.getByRole("button", { name: "ذخیره موجودی" }).click();
    await expect(page.locator("#inventory-editor-error")).toContainText(
      "موجودی نمی‌تواند کمتر از صفر شود",
    );
    await assertMinimumContrast(page.locator("#inventory-editor-error"));
    await assertNoHorizontalOverflow(page);
    await assertInteractiveTargets(
      page,
      "main a, main button, main input, main select, main summary, main textarea",
    );
  } finally {
    await sql.end();
  }
});
