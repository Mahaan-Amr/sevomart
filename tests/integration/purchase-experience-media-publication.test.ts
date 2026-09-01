import { randomUUID } from "node:crypto";

import { mediaReferenceContract } from "@sevo/contracts/media/v1";
import { orderItemIdContract } from "@sevo/contracts/orders/v1";
import {
  identityIdContract,
  productIdContract,
  storeIdContract,
} from "@sevo/contracts/platform/v1";
import postgres from "postgres";
import { afterAll, expect, it } from "vitest";

import { createApiApp } from "../../apps/api/src/create-app";
import { createPaidOrderItemFixture } from "../../apps/api/src/modules/orders/testing/paid-order-item.fixture";
import { apiTestEnvironment } from "../helpers/api-test-environment";

const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 2 });
const testEnvironment = {
  ...apiTestEnvironment,
  DEV_OTP_TEST_MOBILES: [
    "09123456789",
    "09123456780",
  ] as typeof apiTestEnvironment.DEV_OTP_TEST_MOBILES,
};
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

afterAll(async () => sql.end());

function uploadBody() {
  return Buffer.concat([
    Buffer.from(
      '--experience\r\nContent-Disposition: form-data; name="file"; filename="experience.png"\r\nContent-Type: image/png\r\n\r\n',
    ),
    png,
    Buffer.from("\r\n--experience--\r\n"),
  ]);
}

it("keeps eligible buyer media private until the verified experience is published", async () => {
  const app = await createApiApp(testEnvironment);
  const server = app.getHttpAdapter().getInstance();
  const orderItemId = orderItemIdContract.parse(randomUUID());
  const storeId = storeIdContract.parse(randomUUID());
  const productId = productIdContract.parse(randomUUID());
  let buyerId = identityIdContract.parse(randomUUID());
  let mediaId = "";
  let experienceId = "";
  let paidOrder: Awaited<ReturnType<typeof createPaidOrderItemFixture>> | undefined;

  async function signIn(mobile: string) {
    const requested = await server.inject({
      method: "POST",
      url: "/v1/auth/otp/requests",
      payload: { mobile },
    });
    const verified = await server.inject({
      method: "POST",
      url: "/v1/auth/otp/verifications",
      payload: { challengeId: requested.json().challengeId, code: "111111" },
    });
    const cookie = verified.headers["set-cookie"]!;
    const session = await server.inject({
      method: "GET",
      url: "/v1/auth/session",
      headers: { cookie },
    });
    return {
      cookie,
      identityId: identityIdContract.parse(session.json().actor.identityId),
    };
  }

  try {
    const buyer = await signIn("09123456789");
    buyerId = buyer.identityId;
    paidOrder = await createPaidOrderItemFixture(apiTestEnvironment.DATABASE_URL, {
      buyerId,
      storeId,
      productId,
      orderItemId,
    });
    const other = await signIn("09123456780");
    const deniedContext = await server.inject({
      method: "POST",
      url: "/v2/purchase-experiences/media-contexts",
      headers: {
        cookie: other.cookie,
        "idempotency-key": randomUUID(),
      },
      payload: { orderItemId },
    });
    expect(deniedContext.statusCode).toBe(422);

    const createdContext = await server.inject({
      method: "POST",
      url: "/v2/purchase-experiences/media-contexts",
      headers: {
        cookie: buyer.cookie,
        "idempotency-key": randomUUID(),
      },
      payload: { orderItemId },
    });
    expect(createdContext.statusCode).toBe(201);
    expect(createdContext.json()).not.toHaveProperty("orderItemId");

    const uploaded = await server.inject({
      method: "POST",
      url: createdContext.json().uploadUrl,
      headers: {
        cookie: buyer.cookie,
        "idempotency-key": randomUUID(),
        "content-type": "multipart/form-data; boundary=experience",
      },
      payload: uploadBody(),
    });
    expect(uploaded.statusCode).toBe(201);
    const reference = mediaReferenceContract.parse(uploaded.json());
    mediaId = reference.id;
    expect(
      (await server.inject({ method: "GET", url: reference.url })).statusCode,
    ).toBe(401);

    await sql`
      update media_purchase_experience_upload_contexts
      set expires_at = now() - interval '1 minute'
      where order_item_id = ${orderItemId}
    `;

    const published = await server.inject({
      method: "POST",
      url: "/v2/purchase-experiences",
      headers: {
        cookie: buyer.cookie,
        "idempotency-key": randomUUID(),
      },
      payload: {
        buyerId,
        orderItemId,
        rating: 5,
        text: "کالا سالم و مطابق تصویر رسید.",
        mediaIds: [reference.id],
      },
    });
    expect(published.statusCode).toBe(201);
    experienceId = published.json().experienceId;
    expect(
      (await server.inject({ method: "GET", url: reference.url })).statusCode,
    ).toBe(200);
  } finally {
    if (experienceId) {
      await sql`delete from platform_outbox_events where aggregate_id = ${experienceId}`;
      await sql`delete from content_audits where aggregate_id = ${experienceId}`;
      await sql`delete from content_purchase_experiences where id = ${experienceId}`;
    }
    if (mediaId) {
      await sql`delete from media_assets where id = ${mediaId}`;
    }
    await sql`
      delete from media_purchase_experience_upload_contexts
      where order_item_id = ${orderItemId}
    `;
    await sql`delete from content_idempotency_records where actor_id = ${buyerId}`;
    await paidOrder?.cleanup();
    await app.close();
  }
});
