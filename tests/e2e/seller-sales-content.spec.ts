import { randomUUID } from "node:crypto";

import {
  identityIdContract,
  productIdContract,
  storeIdContract,
} from "@sevo/contracts/platform/v1";
import postgres from "postgres";
import sharp from "sharp";

import { expect, test } from "../helpers/release-playwright";
import {
  assertInteractiveTargets,
  assertMinimumContrast,
  assertNoHorizontalOverflow,
} from "../helpers/visual-assertions";
import {
  sellerSalesContentTestMobiles,
  visualProjectIndex,
} from "../helpers/visual-projects";

test("seller creates, edits, and sees stopped sales content", async ({
  page,
}, testInfo) => {
  const index = visualProjectIndex(testInfo.project.name);
  const mobile = sellerSalesContentTestMobiles[index]!;
  const databaseUrl =
    process.env.DATABASE_URL ?? "postgresql://sevo:sevo_local@localhost:6432/sevo";
  const sql = postgres(databaseUrl, { max: 1 });
  const storeId = storeIdContract.parse(randomUUID());
  const productIds = [
    productIdContract.parse(randomUUID()),
    productIdContract.parse(randomUUID()),
  ];
  const mediaIds = [randomUUID(), randomUUID()];
  const variantIds = [randomUUID(), randomUUID()];
  let identityId: ReturnType<typeof identityIdContract.parse> | undefined;

  try {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/seller/login?returnTo=%2Fseller%2Fcontent%2Fnew");
    await page.getByLabel("شماره موبایل").fill(mobile);
    await page.getByRole("button", { name: "دریافت کد" }).click();
    await page.getByLabel("کد شش‌رقمی").fill("111111");
    await page.getByRole("button", { name: "ورود" }).click();
    const [identity] = await sql<Array<{ identityId: string }>>`
      select identity_id as "identityId" from identity_login_methods where mobile = ${mobile}
    `;
    identityId = identityIdContract.parse(identity?.identityId);
    await sql`delete from content_sales_content_products where content_id in (
      select id from content_sales_contents where actor_identity_id = ${identityId}
    )`;
    await sql`delete from content_sales_contents where actor_identity_id = ${identityId}`;
    await sql`delete from product_products where store_id in (
      select store_id from store_memberships where seller_id = ${identityId}
    )`;
    await sql`delete from store_stores where id in (
      select store_id from store_memberships where seller_id = ${identityId}
    )`;
    await sql`
      insert into identity_seller_access (id, identity_id, status)
      values (${randomUUID()}, ${identityId}, 'ACTIVE')
      on conflict (identity_id) do update set status = 'ACTIVE'
    `;
    await sql`
      insert into store_stores
        (id, name, status, revision, publication_version, published_at,
         settlement_kind, settlement_status, settlement_verified_at)
      values (${storeId}, 'فروشگاه محتوای مرورگر', 'PUBLISHED', 1, 1, now(),
        'TEST', 'TEST_VERIFIED', now())
    `;
    await sql`
      insert into store_memberships (id, store_id, seller_id, role)
      values (${randomUUID()}, ${storeId}, ${identityId}, 'OWNER')
    `;
    await sql`
      insert into product_products
        (id, store_id, state, revision, publication_version, published_at)
      values
        (${productIds[0]}, ${storeId}, 'PUBLISHED', 1, 1, now()),
        (${productIds[1]}, ${storeId}, 'PUBLISHED', 1, 1, now())
    `;
    for (let position = 0; position < productIds.length; position += 1) {
      const productId = productIds[position]!;
      const mediaId = mediaIds[position]!;
      const variantId = variantIds[position]!;
      const name =
        position === 0
          ? "کیف دست‌دوز چرمی با نام بلند برای بررسی نمایش درست متن فارسی"
          : "دفتر برنامه‌ریزی روزانه";
      const price = { amount: 1_000, currency: "IRR" };
      await sql`
        insert into product_publications
          (product_id, publication_version, name, description, media_id,
           variant_id, snapshot)
        values (${productId}, 1, ${name}, '', ${mediaId}, ${variantId},
          ${sql.json({
            productId,
            name,
            description: "",
            images: [{ id: mediaId, url: `/v1/media/${mediaId}` }],
            axes: [],
            variants: [
              { variantId, combination: [], price, availability: "AVAILABLE" },
            ],
            priceRange: { minimum: price, maximum: price },
            availability: "AVAILABLE",
            publicationVersion: 1,
          })})
      `;
    }
    await sql`
      insert into product_working_copies
        (product_id, name, description, media_id, variant_id, definition)
      values
        (${productIds[0]},
         'کیف دست‌دوز چرمی با نام بلند برای بررسی نمایش درست متن فارسی', '',
         ${mediaIds[0]}, ${variantIds[0]},
         ${sql.json({
           name: "کیف دست‌دوز چرمی با نام بلند برای بررسی نمایش درست متن فارسی",
           orderedMediaIds: [mediaIds[0]],
         })}),
        (${productIds[1]}, 'دفتر برنامه‌ریزی روزانه', '', ${mediaIds[1]},
         ${variantIds[1]},
         ${sql.json({
           name: "دفتر برنامه‌ریزی روزانه",
           orderedMediaIds: [mediaIds[1]],
         })})
    `;

    await page.goto("/seller/content/new");
    await expect(page.getByRole("heading", { name: "ساخت محتوای فروش" })).toBeVisible();
    const imageInput = page.locator('input[type="file"]');
    await imageInput.setInputFiles({
      name: "cover.mp4",
      mimeType: "video/mp4",
      buffer: Buffer.from("video"),
    });
    await expect(page.getByText(/ویدیو هنوز در سوو پشتیبانی نمی‌شود/)).toBeVisible();
    const firstCover = await sharp({
      create: { width: 320, height: 400, channels: 3, background: "#A41439" },
    })
      .png()
      .toBuffer();
    await imageInput.setInputFiles({
      name: "cover.png",
      mimeType: "image/png",
      buffer: firstCover,
    });
    await expect(page.getByRole("status")).toContainText("تصویر آماده است");
    await page.getByLabel(/کیف دست‌دوز/).check();
    await page.getByLabel("دفتر برنامه‌ریزی روزانه").check();
    await page.getByRole("button", { name: "انتشار محتوا" }).click();
    await page.waitForURL("**/seller/content");
    await expect(page.getByText("منبع: فروشنده")).toBeVisible();
    await expect(
      page.getByText("خرید از دست‌کم یک کالای این محتوا فعال است."),
    ).toBeVisible();
    await assertNoHorizontalOverflow(page);
    await assertInteractiveTargets(
      page,
      'section[aria-labelledby="seller-content-list-title"] a, section[aria-labelledby="seller-content-list-title"] button',
    );
    await assertMinimumContrast(page.locator("h1, p, strong, a, button"));

    const editLink = page.getByRole("link", { name: "ویرایش محتوا" });
    const editHref = await editLink.getAttribute("href");
    if (!editHref) throw new Error("Edit link was not rendered");
    await editLink.click();
    await expect(
      page.getByRole("heading", { name: "ویرایش محتوای فروش" }),
    ).toBeVisible();
    await page.getByLabel("دفتر برنامه‌ریزی روزانه").uncheck();
    const replacementCover = await sharp({
      create: { width: 360, height: 450, channels: 3, background: "#F6E3E9" },
    })
      .png()
      .toBuffer();
    await imageInput.setInputFiles({
      name: "replacement.png",
      mimeType: "image/png",
      buffer: replacementCover,
    });
    await page.getByRole("button", { name: "ثبت تغییرها" }).click();
    await page.waitForURL("**/seller/content");
    await expect(page.getByText("دفتر برنامه‌ریزی روزانه")).toHaveCount(0);

    await sql`update product_products set state = 'UNPUBLISHED' where id = ${productIds[0]}`;
    await sql`
      update content_sales_content_products set active = false
      where product_id = ${productIds[0]}
    `;
    await sql`
      update content_sales_contents set active = false
      where actor_identity_id = ${identityId}
    `;
    await page.reload();
    await expect(page.getByText(/خرید از این محتوا غیرفعال است/)).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(page.locator(":focus")).toBeVisible();
  } finally {
    if (identityId) {
      await sql`delete from platform_outbox_events where aggregate_id in (
        select id from content_sales_contents where actor_identity_id = ${identityId}
      )`;
      await sql`delete from content_idempotency_records where actor_id = ${identityId}`;
      await sql`delete from content_audits where actor_identity_id = ${identityId}`;
      await sql`delete from content_sales_content_products where content_id in (
        select id from content_sales_contents where actor_identity_id = ${identityId}
      )`;
      await sql`delete from content_sales_contents where actor_identity_id = ${identityId}`;
      await sql`delete from media_assets where owner_identity_id = ${identityId}`;
    }
    await sql`delete from product_products where id in ${sql(productIds)}`;
    await sql`delete from store_stores where id = ${storeId}`;
    if (identityId) {
      await sql`delete from identity_seller_access where identity_id = ${identityId}`;
    }
    await sql.end();
  }
});
