import { storeDraftContract, storePublicationContract } from "@sevo/contracts/store/v1";
import { createHash, randomUUID } from "node:crypto";
import postgres from "postgres";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApiApp } from "../../apps/api/src/create-app";
import { apiTestEnvironment } from "../helpers/api-test-environment";

const validPngBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

describe("seller store HTTP API with PostgreSQL", () => {
  const apps: Awaited<ReturnType<typeof createApiApp>>[] = [];

  beforeEach(async () => {
    const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
    await sql`delete from store_idempotency_records`;
    await sql`delete from store_stores`;
    await sql.end();
  });

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  async function startApp() {
    const app = await createApiApp(apiTestEnvironment);
    apps.push(app);
    return app;
  }

  async function signIn(app: Awaited<ReturnType<typeof startApp>>) {
    const server = app.getHttpAdapter().getInstance();
    const requested = await server.inject({
      method: "POST",
      url: "/v1/auth/otp/requests",
      payload: { mobile: "09123456789" },
    });
    const challengeId = requested.json<{ challengeId: string }>().challengeId;
    const verified = await server.inject({
      method: "POST",
      url: "/v1/auth/otp/verifications",
      payload: { challengeId, code: "111111" },
    });
    return verified.headers["set-cookie"]!;
  }

  it("persists, previews and publishes a complete product-free store", async () => {
    const firstApp = await startApp();
    const cookie = await signIn(firstApp);
    const server = firstApp.getHttpAdapter().getInstance();
    const saved = await server.inject({
      method: "PUT",
      url: "/v1/seller/store/draft",
      headers: storeWriteHeaders(cookie, 0),
      payload: {
        name: "خانه سفال ماه",
        slug: "integration-khane-mah",
        bio: "سفال دست‌ساز برای خانه‌های گرم و ساده",
        shippingMethods: [{ code: "NATIONAL_POST", label: "پست پیشتاز" }],
        returnPolicy: "تا هفت روز پس از تحویل امکان درخواست مرجوعی وجود دارد.",
        settlementDestination: { kind: "TEST" },
        logoMediaId: null,
        coverMediaId: null,
        themeColor: "#A41439",
      },
    });

    expect(saved.statusCode).toBe(200);
    expect(storeDraftContract.safeParse(saved.json()).success).toBe(true);
    await firstApp.close();
    apps.splice(apps.indexOf(firstApp), 1);

    const refreshedApp = await startApp();
    const refreshedServer = refreshedApp.getHttpAdapter().getInstance();
    const read = await refreshedServer.inject({
      method: "GET",
      url: "/v1/seller/store/draft",
      headers: { cookie },
    });
    expect(read.statusCode).toBe(200);
    expect(read.json()).toMatchObject({
      slug: "integration-khane-mah",
      status: "DRAFT",
    });

    const preview = await refreshedServer.inject({
      method: "GET",
      url: "/v1/seller/store/preview",
      headers: { cookie },
    });
    expect(preview.json()).toMatchObject({
      publicationReadiness: { ready: true, missingFields: [] },
    });

    const publication = await refreshedServer.inject({
      method: "POST",
      url: "/v1/seller/store/publication",
      headers: storeWriteHeaders(cookie, 1),
    });
    expect(publication.statusCode).toBe(200);
    expect(storePublicationContract.safeParse(publication.json()).success).toBe(true);
    expect(publication.json()).toMatchObject({
      publicUrl: "/s/integration-khane-mah",
      store: { activeProductCount: 0, status: "PUBLISHED" },
    });
  });

  it("replays a pre-normalization receipt for the identical payload and rejects a real change", async () => {
    const app = await startApp();
    const cookie = await signIn(app);
    const server = app.getHttpAdapter().getInstance();
    const key = randomUUID();
    const currentPayload = { name: "فروشگاه بذر" };
    const legacyPayload = { name: "  " };
    const headers = {
      cookie,
      "idempotency-key": key,
      "if-match": '"0"',
    };
    const saved = await server.inject({
      method: "PUT",
      url: "/v1/seller/store/draft",
      headers,
      payload: currentPayload,
    });
    expect(saved.statusCode).toBe(200);

    const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
    const legacyHash = createHash("sha256")
      .update(JSON.stringify(legacyPayload))
      .digest("hex");
    await sql`
      update store_idempotency_records
      set request_hash = ${legacyHash},
          response_json = jsonb_set(response_json, '{name}', to_jsonb('  '::text))
      where operation = 'SAVE_STORE_DRAFT' and idempotency_key = ${key}
    `;
    const beforeReplay = await readReplayEffects(sql, key);
    await sql.end();

    const replay = await server.inject({
      method: "PUT",
      url: "/v1/seller/store/draft",
      headers,
      payload: legacyPayload,
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual({ ...saved.json(), name: "  " });

    const verifySql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
    const afterReplay = await readReplayEffects(verifySql, key);
    await verifySql.end();
    expect(afterReplay).toEqual(beforeReplay);

    const conflict = await server.inject({
      method: "PUT",
      url: "/v1/seller/store/draft",
      headers,
      payload: { name: " x" },
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });

  it("replays a historical shipping payload after the old parser stripped unknown terms", async () => {
    const app = await startApp();
    const cookie = await signIn(app);
    const server = app.getHttpAdapter().getInstance();
    const key = randomUUID();
    const payload = {
      name: "فروشگاه ارسال قدیمی",
      shippingMethods: [
        {
          code: "PICKUP",
          label: "تحویل حضوری",
          fixedFee: { amount: 800_000, currency: "IRR" },
          enabled: false,
        },
      ],
    };
    const headers = {
      cookie,
      "idempotency-key": key,
      "if-match": '"0"',
    };
    const saved = await server.inject({
      method: "PUT",
      url: "/v1/seller/store/draft",
      headers,
      payload,
    });
    expect(saved.statusCode).toBe(200);

    const historicalParsedPayload = {
      name: payload.name,
      shippingMethods: [{ code: "PICKUP", label: "تحویل حضوری" }],
    };
    const historicalHash = createHash("sha256")
      .update(JSON.stringify(historicalParsedPayload))
      .digest("hex");
    const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
    await sql`
      update store_idempotency_records
      set request_hash = ${historicalHash}
      where operation = 'SAVE_STORE_DRAFT' and idempotency_key = ${key}
    `;
    await sql.end();

    const replay = await server.inject({
      method: "PUT",
      url: "/v1/seller/store/draft",
      headers,
      payload,
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual(saved.json());
  });

  it("reads legacy store text and saves a corrected draft through the existing API", async () => {
    const app = await startApp();
    const cookie = await signIn(app);
    const server = app.getHttpAdapter().getInstance();
    const initial = await server.inject({
      method: "PUT",
      url: "/v1/seller/store/draft",
      headers: storeWriteHeaders(cookie, 0),
      payload: {
        name: "فروشگاه قدیمی",
        slug: "legacy-readable-store",
        bio: "معرفی معتبر پیش از ارتقا",
        shippingMethods: [{ code: "PICKUP", label: "تحویل حضوری" }],
        returnPolicy: "قانون مرجوعی معتبر پیش از ارتقا",
        settlementDestination: { kind: "TEST" },
      },
    });
    expect(initial.statusCode).toBe(200);

    const publication = await server.inject({
      method: "POST",
      url: "/v1/seller/store/publication",
      headers: storeWriteHeaders(cookie, 1),
    });
    expect(publication.statusCode).toBe(200);

    const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
    await sql`
      update store_stores
      set name = '  ', bio = ' x', return_policy = '          '
      where slug = 'legacy-readable-store'
    `;
    await sql`
      update store_shipping_methods
      set label = '  '
      where store_id = (select id from store_stores where slug = 'legacy-readable-store')
    `;
    await sql.end();

    const draft = await server.inject({
      method: "GET",
      url: "/v1/seller/store/draft",
      headers: { cookie },
    });
    expect(draft.statusCode).toBe(200);
    expect(draft.headers.etag).toBe('"2"');
    expect(storeDraftContract.safeParse(draft.json()).success).toBe(true);

    const publicRead = await server.inject({
      method: "GET",
      url: "/v1/stores/legacy-readable-store",
    });
    expect(publicRead.statusCode).toBe(200);
    expect(publicRead.json()).toMatchObject({ name: "  ", bio: " x" });

    const corrected = await server.inject({
      method: "PUT",
      url: "/v1/seller/store/draft",
      headers: storeWriteHeaders(cookie, 2),
      payload: {
        name: "فروشگاه اصلاح‌شده",
        bio: "معرفی اصلاح‌شده فروشگاه",
        returnPolicy: "قانون اصلاح‌شده مرجوعی فروشگاه",
        shippingMethods: [{ code: "PICKUP", label: "تحویل حضوری" }],
      },
    });
    expect(corrected.statusCode).toBe(200);
    expect(corrected.json()).toMatchObject({
      revision: 3,
      name: "فروشگاه اصلاح‌شده",
      status: "DRAFT",
    });
  });

  it("keeps short legacy text readable but blocks publication until it meets current minimums", async () => {
    const app = await startApp();
    const cookie = await signIn(app);
    const server = app.getHttpAdapter().getInstance();
    const saved = await server.inject({
      method: "PUT",
      url: "/v1/seller/store/draft",
      headers: storeWriteHeaders(cookie, 0),
      payload: {
        name: "فروشگاه قدیمی",
        slug: "legacy-short-readiness",
        bio: "معرفی معتبر پیش از ارتقا",
        shippingMethods: [{ code: "PICKUP", label: "تحویل حضوری" }],
        returnPolicy: "قانون مرجوعی معتبر پیش از ارتقا",
        settlementDestination: { kind: "TEST" },
      },
    });
    expect(saved.statusCode).toBe(200);

    const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
    await sql`
      update store_stores
      set name = ' x', bio = ' x', return_policy = ' 123456789'
      where slug = 'legacy-short-readiness'
    `;
    await sql`
      update store_shipping_methods
      set label = ' x'
      where store_id = (
        select id from store_stores where slug = 'legacy-short-readiness'
      )
    `;
    await sql.end();

    const draft = await server.inject({
      method: "GET",
      url: "/v1/seller/store/draft",
      headers: { cookie },
    });
    expect(draft.statusCode).toBe(200);
    expect(draft.json()).toMatchObject({
      name: " x",
      bio: " x",
      returnPolicy: " 123456789",
      shippingMethods: [{ label: " x", enabled: true }],
    });

    const preview = await server.inject({
      method: "GET",
      url: "/v1/seller/store/preview",
      headers: { cookie },
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.json().publicationReadiness).toEqual({
      ready: false,
      missingFields: ["NAME", "BIO", "SHIPPING_METHOD", "RETURN_POLICY"],
    });

    const publication = await server.inject({
      method: "POST",
      url: "/v1/seller/store/publication",
      headers: storeWriteHeaders(cookie, 1),
    });
    expect(publication.statusCode).toBe(422);
    expect(publication.json()).toMatchObject({
      code: "VALIDATION_ERROR",
      details: {
        issues: [
          { field: "name", code: "REQUIRED" },
          { field: "bio", code: "REQUIRED" },
          { field: "shipping_method", code: "REQUIRED" },
          { field: "return_policy", code: "REQUIRED" },
        ],
      },
    });
  });

  it("accepts multipart media above the former JSON body limit and keeps it private until publication", async () => {
    const app = await startApp();
    const cookie = await signIn(app);
    const server = app.getHttpAdapter().getInstance();
    const source = await sharp({
      create: { width: 900, height: 900, channels: 4, background: "#A41439" },
    })
      .png({ compressionLevel: 0 })
      .toBuffer();
    const upload = await server.inject({
      method: "POST",
      url: "/v1/seller/media",
      headers: { cookie, ...multipartHeaders("sevo-boundary") },
      payload: multipartBody(
        "sevo-boundary",
        "STORE_LOGO",
        "logo.png",
        "image/png",
        source,
      ),
    });
    expect(source.byteLength).toBeGreaterThan(1_048_576);
    expect(upload.statusCode).toBe(201);
    const media = upload.json<{ id: string; url: string }>();

    const privateRead = await server.inject({ method: "GET", url: media.url });
    expect(privateRead.statusCode).toBe(401);

    const saveHeaders = storeWriteHeaders(cookie, 0);
    const savePayload = {
      name: "خانه رسانه",
      slug: "integration-media-store",
      bio: "فروشگاه آزمایشی با نشان اختصاصی",
      shippingMethods: [{ code: "NATIONAL_POST", label: "پست پیشتاز" }],
      returnPolicy: "تا هفت روز پس از تحویل امکان درخواست مرجوعی وجود دارد.",
      settlementDestination: { kind: "TEST" },
      logoMediaId: media.id,
      coverMediaId: null,
      themeColor: "#A41439",
    };
    const saved = await server.inject({
      method: "PUT",
      url: "/v1/seller/store/draft",
      headers: saveHeaders,
      payload: savePayload,
    });
    expect(saved.statusCode).toBe(200);

    const publication = await server.inject({
      method: "POST",
      url: "/v1/seller/store/publication",
      headers: storeWriteHeaders(cookie, 1),
    });
    expect(publication.statusCode).toBe(200);

    const publicRead = await server.inject({ method: "GET", url: media.url });
    expect(publicRead.statusCode).toBe(200);
    expect(publicRead.headers["content-type"]).toContain("image/webp");

    const delayedSaveReplay = await server.inject({
      method: "PUT",
      url: "/v1/seller/store/draft",
      headers: saveHeaders,
      payload: savePayload,
    });
    expect(delayedSaveReplay.json()).toEqual(saved.json());
    const stillPublic = await server.inject({ method: "GET", url: media.url });
    expect(stillPublic.statusCode).toBe(200);

    const publicStore = await server.inject({
      method: "GET",
      url: "/v1/stores/integration-media-store",
    });
    expect(publicStore.statusCode).toBe(200);
    expect(publicStore.json()).toMatchObject({
      logo: { id: media.id, contentType: "image/webp" },
      status: "PUBLISHED",
    });

    const edited = await server.inject({
      method: "PUT",
      url: "/v1/seller/store/draft",
      headers: storeWriteHeaders(cookie, 2),
      payload: { name: "خانه رسانه تازه" },
    });
    expect(edited.json()).toMatchObject({ status: "DRAFT" });
    const noLongerPublic = await server.inject({
      method: "GET",
      url: "/v1/stores/integration-media-store",
    });
    expect(noLongerPublic.statusCode).toBe(404);
    const privateAgain = await server.inject({ method: "GET", url: media.url });
    expect(privateAgain.statusCode).toBe(401);
  });

  it("rejects corrupt bytes that merely claim an image content type", async () => {
    const app = await startApp();
    const cookie = await signIn(app);
    const server = app.getHttpAdapter().getInstance();

    const upload = await server.inject({
      method: "POST",
      url: "/v1/seller/media",
      headers: { cookie, ...multipartHeaders("broken-boundary") },
      payload: multipartBody(
        "broken-boundary",
        "STORE_LOGO",
        "broken.png",
        "image/png",
        Buffer.from("not an image"),
      ),
    });

    expect(upload.statusCode).toBe(422);
    expect(upload.json()).toMatchObject({
      code: "VALIDATION_ERROR",
      message: "فایل تصویر خراب است یا کامل خوانده نمی‌شود.",
    });
  });

  it("rejects a recognizable but truncated image", async () => {
    const app = await startApp();
    const cookie = await signIn(app);
    const server = app.getHttpAdapter().getInstance();
    const truncated = Buffer.from(validPngBase64, "base64").subarray(0, -20);

    const upload = await server.inject({
      method: "POST",
      url: "/v1/seller/media",
      headers: { cookie, ...multipartHeaders("truncated-boundary") },
      payload: multipartBody(
        "truncated-boundary",
        "STORE_COVER",
        "truncated.png",
        "image/png",
        truncated,
      ),
    });

    expect(upload.statusCode).toBe(422);
    expect(upload.json()).toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("returns precise errors for oversized, over-dimensioned, mismatched and animated images", async () => {
    const app = await startApp();
    const cookie = await signIn(app);
    const server = app.getHttpAdapter().getInstance();
    const cases: Array<{
      name: string;
      contentType: string;
      bytes: Buffer;
      status: number;
      issue: string;
      message: string;
    }> = [
      {
        name: "too-large.png",
        contentType: "image/png",
        bytes: Buffer.alloc(10 * 1024 * 1024 + 1),
        status: 413,
        issue: "FILE_TOO_LARGE",
        message: "حجم تصویر باید حداکثر ۱۰ مگابایت باشد.",
      },
      {
        name: "too-wide.png",
        contentType: "image/png",
        bytes: await sharp({
          create: { width: 5_000, height: 5_000, channels: 3, background: "white" },
        })
          .png()
          .toBuffer(),
        status: 422,
        issue: "IMAGE_TOO_LARGE",
        message: "ابعاد تصویر باید حداکثر ۲۴ مگاپیکسل باشد.",
      },
      {
        name: "mismatch.jpg",
        contentType: "image/jpeg",
        bytes: Buffer.from(validPngBase64, "base64"),
        status: 422,
        issue: "MIME_MISMATCH",
        message: "نوع فایل با محتوای واقعی تصویر هماهنگ نیست.",
      },
      {
        name: "animated.webp",
        contentType: "image/webp",
        bytes: await animatedWebp(),
        status: 422,
        issue: "ANIMATED_IMAGE",
        message: "تصویر متحرک پذیرفته نمی‌شود.",
      },
    ];

    for (const [index, testCase] of cases.entries()) {
      const boundary = `invalid-media-${index}`;
      const response = await server.inject({
        method: "POST",
        url: "/v1/seller/media",
        headers: { cookie, ...multipartHeaders(boundary) },
        payload: multipartBody(
          boundary,
          "STORE_LOGO",
          testCase.name,
          testCase.contentType,
          testCase.bytes,
        ),
      });
      expect(response.json()).toMatchObject({
        code: "VALIDATION_ERROR",
        message: testCase.message,
        details: { issues: [{ field: "media", code: testCase.issue }] },
      });
      expect(response.statusCode, testCase.name).toBe(testCase.status);
    }
  });
});

async function animatedWebp() {
  return sharp(
    [
      { create: { width: 2, height: 2, channels: 4, background: "red" } },
      { create: { width: 2, height: 2, channels: 4, background: "blue" } },
    ],
    { join: { animated: true } },
  )
    .webp({ loop: 0, delay: [100, 100] })
    .toBuffer();
}

function multipartHeaders(boundary: string) {
  return { "content-type": `multipart/form-data; boundary=${boundary}` };
}

function storeWriteHeaders(cookie: string, expectedRevision: number) {
  return {
    cookie,
    "idempotency-key": crypto.randomUUID(),
    "if-match": `"${expectedRevision}"`,
  };
}

async function readReplayEffects(
  sql: ReturnType<typeof postgres>,
  idempotencyKey: string,
) {
  const [effects] = await sql<
    Array<{
      revision: number;
      shippingRows: number;
      outboxEvents: number;
      receipts: number;
    }>
  >`
    select
      s.revision,
      (select count(*)::int from store_shipping_methods sm where sm.store_id = s.id) as "shippingRows",
      (select count(*)::int from platform_outbox_events e where e.aggregate_id = s.id) as "outboxEvents",
      (select count(*)::int from store_idempotency_records r
        where r.operation = 'SAVE_STORE_DRAFT' and r.idempotency_key = ${idempotencyKey}) as receipts
    from store_stores s
    join store_memberships m on m.store_id = s.id
    where m.seller_id = (
      select actor_identity_id from store_idempotency_records
      where operation = 'SAVE_STORE_DRAFT' and idempotency_key = ${idempotencyKey}
    )
  `;
  return effects;
}

function multipartBody(
  boundary: string,
  purpose: "STORE_LOGO" | "STORE_COVER",
  fileName: string,
  contentType: string,
  bytes: Buffer,
) {
  return Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="purpose"\r\n\r\n${purpose}\r\n`,
    ),
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: ${contentType}\r\n\r\n`,
    ),
    bytes,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
}
