import { storeDraftContract, storePublicationContract } from "@sevo/contracts/store/v1";
import postgres from "postgres";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApiApp } from "../../apps/api/src/create-app";
import { apiTestEnvironment } from "../helpers/api-test-environment";

describe("seller store HTTP API with PostgreSQL", () => {
  const apps: Awaited<ReturnType<typeof createApiApp>>[] = [];

  beforeEach(async () => {
    const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
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
      headers: { cookie },
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
      headers: { cookie },
    });
    expect(publication.statusCode).toBe(200);
    expect(storePublicationContract.safeParse(publication.json()).success).toBe(true);
    expect(publication.json()).toMatchObject({
      publicUrl: "/s/integration-khane-mah",
      store: { activeProductCount: 0, status: "PUBLISHED" },
    });
  });

  it("keeps uploaded media private until its store is published", async () => {
    const app = await startApp();
    const cookie = await signIn(app);
    const server = app.getHttpAdapter().getInstance();
    const upload = await server.inject({
      method: "POST",
      url: "/v1/seller/media",
      headers: { cookie },
      payload: {
        fileName: "logo.png",
        contentType: "image/png",
        contentBase64: "iVBORw==",
      },
    });
    expect(upload.statusCode).toBe(201);
    const media = upload.json<{ id: string; url: string }>();

    const privateRead = await server.inject({ method: "GET", url: media.url });
    expect(privateRead.statusCode).toBe(401);

    const saved = await server.inject({
      method: "PUT",
      url: "/v1/seller/store/draft",
      headers: { cookie },
      payload: {
        name: "خانه رسانه",
        slug: "integration-media-store",
        bio: "فروشگاه آزمایشی با نشان اختصاصی",
        shippingMethods: [{ code: "NATIONAL_POST", label: "پست پیشتاز" }],
        returnPolicy: "تا هفت روز پس از تحویل امکان درخواست مرجوعی وجود دارد.",
        settlementDestination: { kind: "TEST" },
        logoMediaId: media.id,
        coverMediaId: null,
        themeColor: "#A41439",
      },
    });
    expect(saved.statusCode).toBe(200);

    const publication = await server.inject({
      method: "POST",
      url: "/v1/seller/store/publication",
      headers: { cookie },
    });
    expect(publication.statusCode).toBe(200);

    const publicRead = await server.inject({ method: "GET", url: media.url });
    expect(publicRead.statusCode).toBe(200);
    expect(publicRead.headers["content-type"]).toContain("image/png");

    const publicStore = await server.inject({
      method: "GET",
      url: "/v1/stores/integration-media-store",
    });
    expect(publicStore.statusCode).toBe(200);
    expect(publicStore.json()).toMatchObject({
      logo: { id: media.id, contentType: "image/png" },
      status: "PUBLISHED",
    });

    const edited = await server.inject({
      method: "PUT",
      url: "/v1/seller/store/draft",
      headers: { cookie },
      payload: { name: "خانه رسانه تازه" },
    });
    expect(edited.json()).toMatchObject({ status: "DRAFT" });
    const noLongerPublic = await server.inject({
      method: "GET",
      url: "/v1/stores/integration-media-store",
    });
    expect(noLongerPublic.statusCode).toBe(404);
  });
});
