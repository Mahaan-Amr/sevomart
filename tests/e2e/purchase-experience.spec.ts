import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";
import { directSettlementDisclosure } from "@sevo/contracts/orders/v1";
import postgres from "postgres";
import sharp from "sharp";

import {
  paymentBuyerTestMobiles,
  visualProjectIndex,
} from "../helpers/visual-projects";
import { assertMinimumContrast } from "../helpers/visual-assertions";

test("eligible buyer retries once and publishes one verified purchase experience", async ({
  page,
}, testInfo) => {
  const databaseUrl =
    process.env.DATABASE_URL ?? "postgresql://sevo:sevo_local@localhost:6432/sevo";
  const sql = postgres(databaseUrl, { max: 1 });
  const mobile = paymentBuyerTestMobiles[visualProjectIndex(testInfo.project.name)]!;
  const orderItemId = randomUUID();
  const storeId = randomUUID();
  const productId = randomUUID();
  const variantId = randomUUID();
  const mediaId = randomUUID();
  const shippingMethodId = randomUUID();
  const slug = `purchase-experience-${visualProjectIndex(testInfo.project.name)}`;
  const cartId = randomUUID();
  const checkoutId = randomUUID();
  const orderId = randomUUID();
  const addressId = randomUUID();
  const reviewSnapshot = {
    checkoutRevision: checkoutId,
    expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    cart: { cartId, revision: 1 },
    store: { storeId, name: "فروشگاه تجربه" },
    items: [
      {
        productId,
        variantId,
        name: "کالای تأییدشده",
        quantity: 1,
        publicationVersion: 1,
        unitPrice: { amount: 1000, currency: "IRR" },
        lineTotal: { amount: 1000, currency: "IRR" },
      },
    ],
    address: {
      addressId,
      revision: 1,
      recipientName: "خریدار آزمون",
      recipientMobile: mobile,
      provinceText: "تهران",
      cityText: "تهران",
      addressLine: "خیابان آزمون، پلاک ۱",
      postalCode: "1234567890",
    },
    shippingMethod: {
      id: shippingMethodId,
      revision: 1,
      code: "NATIONAL_POST",
      label: "پست پیشتاز",
      fee: { amount: 500000, currency: "IRR" },
      estimatedDeliveryText: "۳ تا ۵ روز کاری",
      requiresDeliveryAddress: true,
    },
    returnPolicy: {
      revision: 1,
      text: "تا هفت روز امکان درخواست مرجوعی دارید.",
    },
    subtotal: { amount: 1000, currency: "IRR" },
    total: { amount: 501000, currency: "IRR" },
    settlement: { mode: "DIRECT", disclosure: directSettlementDisclosure },
  };
  let orderCreated = false;
  try {
    await page.goto("/login?next=/");
    await page.getByLabel("شماره موبایل").fill(mobile);
    await page.getByRole("button", { name: "دریافت کد" }).click();
    await page.getByLabel("کد شش‌رقمی").fill("111111");
    await Promise.all([
      page.waitForURL((url) => !url.pathname.startsWith("/login")),
      page.getByRole("button", { name: "ورود" }).click(),
    ]);
    const [identity] = await sql<Array<{ identityId: string }>>`
      select identity_id as "identityId"
      from identity_login_methods where mobile = ${mobile}
    `;
    const buyerId = identity?.identityId;
    if (!buyerId) throw new Error("Buyer login did not create an identity");
    await sql`
      insert into store_stores
        (id, name, slug, bio, return_policy, return_policy_revision,
         settlement_kind, settlement_status, settlement_verified_at,
         status, published_at, publication_version, revision, updated_at)
      values
        (${storeId}, 'فروشگاه تجربه', ${slug}, 'کالاهای آزمون تجربه خرید',
         'تا هفت روز امکان درخواست مرجوعی دارید.', 1,
         'TEST', 'TEST_VERIFIED', now(), 'PUBLISHED', now(), 1, 1, now())
    `;
    await sql`
      insert into store_shipping_methods
        (id, store_id, position, revision, code, label, fixed_fee_amount,
         estimated_delivery_text, enabled, requires_delivery_address,
         requires_postal_code)
      values (${shippingMethodId}, ${storeId}, 0, 1, 'NATIONAL_POST',
        'پست پیشتاز', 500000, '۳ تا ۵ روز کاری', true, true, true)
    `;
    await sql`
      insert into store_memberships (id, store_id, seller_id, role)
      values (${randomUUID()}, ${storeId}, ${buyerId}, 'OWNER')
    `;
    await sql`
      insert into product_products
        (id, store_id, state, revision, publication_version, published_at)
      values (${productId}, ${storeId}, 'PUBLISHED', 2, 1, now())
    `;
    await sql`
      insert into product_variants
        (id, product_id, store_id, client_key, combination_key,
         retired, ever_published)
      values (${variantId}, ${productId}, ${storeId}, 'default', 'default',
        false, true)
    `;
    await sql`
      insert into product_publications
        (product_id, publication_version, name, description, media_id, variant_id)
      values (${productId}, 1, 'کالای تأییدشده',
        'شرح کالای تأییدشده برای نمایش عمومی تجربه', ${mediaId}, ${variantId})
    `;
    await sql`
      insert into product_offers (product_id, variant_id, amount, currency, revision)
      values (${productId}, ${variantId}, 1000, 'IRR', 1)
    `;
    await sql`
      insert into inventory_levels (variant_id, store_id, on_hand, revision)
      values (${variantId}, ${storeId}, 8, 1)
    `;
    await sql`
      insert into order_carts
        (id, store_id, identity_id, status, revision, expires_at)
      values (${cartId}, ${storeId}, ${buyerId}, 'CONVERTED', 1,
        now() + interval '1 day')
    `;
    await sql`
      insert into order_checkout_preparations
        (checkout_revision, identity_id, cart_id, cart_revision,
         shipping_method_id, shipping_revision, policy_revision, snapshot, expires_at)
      values (${checkoutId}, ${buyerId}, ${cartId}, 1, ${shippingMethodId}, 1, 1,
        ${sql.json(reviewSnapshot)}, now() + interval '1 day')
    `;
    await sql`
      insert into order_orders
        (id, identity_id, store_id, checkout_revision, reservation_id, status,
         total_amount, currency, reservation_expires_at, review_snapshot, paid_at)
      values (${orderId}, ${buyerId}, ${storeId}, ${checkoutId}, ${randomUUID()},
        'PAID', 501000, 'IRR', now() + interval '1 day',
        ${sql.json(reviewSnapshot)}, now())
    `;
    await sql`
      insert into order_items
        (id, order_id, variant_id, product_id, name, quantity,
         unit_price_amount, publication_version)
      values (${orderItemId}, ${orderId}, ${variantId}, ${productId},
        'کالای تأییدشده', 1, 1000, 1)
    `;
    orderCreated = true;

    const requestKeys: string[] = [];
    let interrupted = false;
    await page.route(/\/api\/purchase-experiences$/, async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      requestKeys.push(route.request().headers()["idempotency-key"] ?? "");
      if (!interrupted) {
        interrupted = true;
        return route.abort("connectionfailed");
      }
      return route.continue();
    });
    const mediaContextKeys: string[] = [];
    await page.route(/\/api\/purchase-experiences\/media-contexts$/, async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      mediaContextKeys.push(route.request().headers()["idempotency-key"] ?? "");
      return route.continue();
    });
    const mediaUploadKeys: string[] = [];
    let mediaValidationRejectionsRemaining = 4;
    let expiredMediaContext = false;
    let expiredMediaUploadKey = "";
    await page.route(/\/api\/purchase-experience-media\/[0-9a-f-]+$/, async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      const uploadKey = route.request().headers()["idempotency-key"] ?? "";
      mediaUploadKeys.push(uploadKey);
      if (mediaValidationRejectionsRemaining > 0) {
        mediaValidationRejectionsRemaining -= 1;
        return route.fulfill({
          status: 422,
          contentType: "application/json",
          body: JSON.stringify({
            code: "VALIDATION_ERROR",
            message: "فایل تصویر خراب است یا کامل خوانده نمی‌شود.",
            details: { issues: [{ field: "media", code: "CORRUPT_IMAGE" }] },
          }),
        });
      }
      if (!expiredMediaContext) {
        expiredMediaContext = true;
        expiredMediaUploadKey = uploadKey;
        return route.fulfill({
          status: 410,
          contentType: "application/json",
          body: JSON.stringify({
            code: "MEDIA_NOT_FOUND",
            message: "مهلت بارگذاری تصویر تمام شده است. دوباره تلاش کنید.",
          }),
        });
      }
      return route.continue();
    });

    const returnTo = `/orders/${orderId}`;
    await page.goto(returnTo);
    const experienceAction = page.getByRole("link", {
      name: `ثبت تجربه خرید برای کالای تأییدشده`,
    });
    await expect(experienceAction).toHaveAttribute(
      "href",
      `/purchase-experiences/new?${new URLSearchParams({ orderItemId, returnTo })}`,
    );
    await experienceAction.click();
    await expect(
      page.getByRole("heading", { name: "تجربه این خرید را ثبت کنید" }),
    ).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await page.getByRole("radio", { name: "۵" }).check();
    await page
      .getByLabel("توضیح شما (اختیاری)")
      .fill("کالا دقیقاً مطابق توضیح رسید و بسته‌بندی مرتب بود. ".repeat(8));
    const imageInput = page.getByLabel("افزودن تصویر");
    await page.getByLabel("توضیح شما (اختیاری)").focus();
    await page.keyboard.press("Tab");
    await expect(imageInput).toBeFocused();
    await expect(imageInput.locator("..")).toHaveCSS("outline-style", "solid");
    await imageInput.setInputFiles({
      name: "not-an-image.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("not an image"),
    });
    await expect(
      page.getByText("فقط تصویر JPEG، PNG یا WebP انتخاب کنید."),
    ).toBeVisible();
    await expect(page.getByRole("listitem")).toHaveCount(0);
    await imageInput.setInputFiles({
      name: "too-large.png",
      mimeType: "image/png",
      buffer: Buffer.alloc(10 * 1024 * 1024 + 1),
    });
    await expect(
      page.getByText("حجم هر تصویر باید حداکثر ۱۰ مگابایت باشد."),
    ).toBeVisible();
    const experienceImage = await sharp({
      create: {
        width: 32,
        height: 32,
        channels: 4,
        background: { r: 164, g: 20, b: 57, alpha: 1 },
      },
    })
      .png()
      .toBuffer();
    await imageInput.setInputFiles(
      [1, 2, 3, 4].map((number) => ({
        name: `server-invalid-${number}.png`,
        mimeType: "image/png",
        buffer: Buffer.from(`invalid image ${number}`),
      })),
    );
    await assertMinimumContrast(imageInput.locator(".."));
    await page.getByRole("button", { name: "ثبت تجربه خرید" }).click();
    await expect(
      page.getByText("فایل تصویر خراب است یا کامل خوانده نمی‌شود."),
    ).toHaveCount(4);
    for (const number of [1, 2, 3, 4]) {
      await page
        .getByRole("listitem")
        .filter({ hasText: `server-invalid-${number}.png` })
        .getByRole("button", { name: "حذف" })
        .click();
    }
    await expect(page.getByRole("listitem")).toHaveCount(0);
    await expect(imageInput).toBeEnabled();
    await imageInput.setInputFiles({
      name: "experience.png",
      mimeType: "image/png",
      buffer: experienceImage,
    });
    await expect(page.getByText("آماده بارگذاری است.")).toBeVisible();
    await imageInput.setInputFiles(
      [1, 2, 3, 4].map((number) => ({
        name: `extra-${number}.png`,
        mimeType: "image/png",
        buffer: experienceImage,
      })),
    );
    await expect(
      page.getByText("حداکثر چهار تصویر می‌توانید اضافه کنید."),
    ).toBeVisible();
    const selectedImages = page.getByRole("list", {
      name: "تصاویر انتخاب‌شده",
    });
    await expect(selectedImages.getByRole("listitem")).toHaveCount(4);
    await expect(selectedImages.getByText("extra-4.png")).toHaveCount(0);
    for (const number of [1, 2, 3]) {
      await selectedImages
        .getByRole("listitem")
        .filter({ hasText: `extra-${number}.png` })
        .getByRole("button", { name: "حذف" })
        .click();
    }
    await expect(selectedImages.getByRole("listitem")).toHaveCount(1);
    await assertMinimumContrast(imageInput.locator(".."));
    await assertMinimumContrast(page.getByText("آماده بارگذاری است."));

    await page.getByRole("button", { name: "ثبت تجربه خرید" }).click();
    await expect(
      page.getByText("مهلت بارگذاری تصویر تمام شده است. دوباره تلاش کنید."),
    ).toBeVisible();
    await page.getByRole("button", { name: "تلاش دوباره" }).click();
    await expect(page.getByText("تصویر آماده است.")).toBeVisible();
    expect(expiredMediaUploadKey).toBeTruthy();
    expect(
      mediaUploadKeys.filter((uploadKey) => uploadKey === expiredMediaUploadKey),
    ).toHaveLength(2);
    expect(mediaContextKeys).toHaveLength(3);
    expect(mediaContextKeys[0]).toBeTruthy();
    expect(new Set(mediaContextKeys).size).toBe(1);

    await page.getByRole("button", { name: "ثبت تجربه خرید" }).click();
    await expect(
      page.getByText(
        "ثبت کامل تأیید نشد. برای جلوگیری از ثبت تکراری، همین اطلاعات را دوباره ارسال کنید.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(page.getByRole("radio", { name: "۵" })).toBeDisabled();
    await expect(page.getByLabel("توضیح شما (اختیاری)")).toBeDisabled();
    await expect(imageInput).toBeDisabled();
    await page.getByRole("button", { name: "تلاش دوباره برای ثبت" }).click();
    await expect(page.getByText("منتشر شد", { exact: true })).toBeVisible();
    expect(requestKeys).toHaveLength(2);
    expect(requestKeys[0]).toBeTruthy();
    expect(requestKeys[1]).toBe(requestKeys[0]);

    await page.getByRole("link", { name: "بازگشت به سفارش" }).click();
    await expect(page).toHaveURL(returnTo);
    await expect(page.getByText("تجربه این خرید ثبت شده است.")).toBeVisible();
    await expect(experienceAction).toHaveCount(0);

    const [experience] = await sql<
      Array<{
        experienceId: string;
        source: string;
        moderationState: string;
        mediaIds: string[];
      }>
    >`
      select id as "experienceId", source,
        moderation_state as "moderationState", media_ids as "mediaIds"
      from content_purchase_experiences where order_item_id = ${orderItemId}
    `;
    expect(experience).toMatchObject({
      source: "VERIFIED_PURCHASE",
      moderationState: "PUBLISHED",
      mediaIds: [expect.any(String)],
    });
    const feed = await page.request.get(
      `http://127.0.0.1:${process.env.SEVO_E2E_API_PORT ?? "3109"}/v2/products/${productId}/purchase-experiences`,
    );
    expect(await feed.json()).toMatchObject({
      summary: { verifiedPurchaseCount: 1, averageRating: null },
      experiences: [
        {
          experienceId: experience?.experienceId,
          source: "VERIFIED_PURCHASE",
          moderationState: "PUBLISHED",
        },
      ],
    });

    await page.goto(`/s/${slug}/products/${productId}`);
    await expect(page.getByRole("heading", { name: "تجربه‌های خرید" })).toBeVisible();
    await expect(page.getByText("۱ خرید تأییدشده")).toContainText(
      "برای نمایش میانگین هنوز نمونه کافی نیست",
    );
    await expect(page.getByText("خرید تأییدشده", { exact: true })).toBeVisible();
    await expect(
      page.getByText("کالا دقیقاً مطابق توضیح رسید و بسته‌بندی مرتب بود.", {
        exact: false,
      }),
    ).toBeVisible();
    const publicExperienceImage = page.getByRole("img", {
      name: "تصویر تجربه خرید ۱",
    });
    await expect(publicExperienceImage).toBeVisible();
    await expect
      .poll(() =>
        publicExperienceImage.evaluate(
          (image) =>
            image instanceof HTMLImageElement &&
            image.complete &&
            image.naturalWidth > 0,
        ),
      )
      .toBe(true);
    await expect(page.getByText(/میانگین [۰-۹]/)).toHaveCount(0);
    await sql`
      insert into content_purchase_experiences
        (id, buyer_identity_id, order_item_id, store_id, product_id,
         moderation_state, rating, text, media_ids)
      values
        (${randomUUID()}, ${buyerId}, ${randomUUID()}, ${storeId}, ${productId},
         'PUBLISHED', 4, 'تجربه دوم برای آستانه', '{}'),
        (${randomUUID()}, ${buyerId}, ${randomUUID()}, ${storeId}, ${productId},
         'PUBLISHED', 3, 'تجربه سوم برای آستانه', '{}')
    `;
    await page.reload();
    await expect(page.getByText("۳ خرید تأییدشده")).toContainText("میانگین ۴ از ۵");

    await page.goto(
      `/purchase-experiences/new?${new URLSearchParams({ orderItemId, returnTo })}`,
    );
    await expect(
      page.getByText("برای این خرید قبلاً یک تجربه ثبت شده است."),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.emulateMedia({ reducedMotion: "reduce" });
    expect(
      await page
        .getByRole("link", { name: "بازگشت" })
        .evaluate((element) => getComputedStyle(element).animationDuration),
    ).toBe("0s");
  } finally {
    const [experience] = await sql<Array<{ id: string }>>`
      select id from content_purchase_experiences where order_item_id = ${orderItemId}
    `;
    if (experience) {
      await sql`delete from platform_outbox_events where aggregate_id = ${experience.id}`;
      await sql`delete from content_audits where aggregate_id = ${experience.id}`;
    }
    await sql`delete from content_idempotency_records where actor_id in (
      select identity_id from identity_login_methods where mobile = ${mobile}
    )`;
    await sql`delete from content_purchase_experiences where buyer_identity_id in (
      select identity_id from identity_login_methods where mobile = ${mobile}
    )`;
    if (orderCreated) {
      await sql`delete from order_items where order_id = ${orderId}`;
      await sql`delete from order_orders where id = ${orderId}`;
      await sql`delete from order_checkout_preparations where checkout_revision = ${checkoutId}`;
      await sql`delete from order_carts where id = ${cartId}`;
    }
    await sql`delete from inventory_levels where variant_id = ${variantId}`;
    await sql`delete from product_offers where product_id = ${productId}`;
    await sql`delete from product_publications where product_id = ${productId}`;
    await sql`delete from product_variants where product_id = ${productId}`;
    await sql`delete from product_products where id = ${productId}`;
    await sql`delete from store_shipping_methods where store_id = ${storeId}`;
    await sql`delete from store_memberships where store_id = ${storeId}`;
    await sql`delete from store_stores where id = ${storeId}`;
    await sql.end();
  }
});
