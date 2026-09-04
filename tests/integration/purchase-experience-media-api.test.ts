import { randomUUID } from "node:crypto";

import {
  PURCHASE_EXPERIENCE_MEDIA_MAX_ITEMS,
  mediaReferenceContract,
} from "@sevo/contracts/media/v1";
import { identityIdContract } from "@sevo/contracts/platform/v1";
import type { FastifyInstance } from "fastify";
import { afterEach, expect, it } from "vitest";
import sharp from "sharp";

import { createMediaTestApp } from "../../apps/api/testing/create-media-test-app";
import {
  PURCHASE_EXPERIENCE_MEDIA,
  type PurchaseExperienceMedia,
} from "../../apps/api/src/modules/media/public";
import { apiTestEnvironment } from "../helpers/api-test-environment";

const apps: Awaited<ReturnType<typeof createMediaTestApp>>[] = [];
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

afterEach(async () => {
  await Promise.all(apps.splice(0).map(({ app }) => app.close()));
});

function uploadBody(image = png) {
  return Buffer.concat([
    Buffer.from(
      '--experience\r\nContent-Disposition: form-data; name="file"; filename="experience.png"\r\nContent-Type: image/png\r\n\r\n',
    ),
    image,
    Buffer.from("\r\n--experience--\r\n"),
  ]);
}

async function signIn(server: FastifyInstance, mobile: string) {
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
  const cookie = verified.headers["set-cookie"] as string;
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

it("uploads, privately previews and idempotently retries a real buyer image", async () => {
  const fixture = await createMediaTestApp(
    { ...apiTestEnvironment, DEV_OTP_TEST_MOBILES: undefined },
    async () => false,
    async () => false,
    async () => true,
  );
  apps.push(fixture);
  const server = fixture.app.getHttpAdapter().getInstance();
  const buyer = await signIn(server, "09123456789");
  const other = await signIn(server, "09123456780");
  const orderItemId = randomUUID();
  const media = fixture.app.get<PurchaseExperienceMedia>(PURCHASE_EXPERIENCE_MEDIA);
  const context = await media.issueUploadContext({
    identityId: buyer.identityId,
    orderItemId,
  });

  const upload = (idempotencyKey: string) =>
    server.inject({
      method: "POST",
      url: `/v1/purchase-experience-media/${context.contextId}`,
      headers: {
        cookie: buyer.cookie,
        "idempotency-key": idempotencyKey,
        "content-type": "multipart/form-data; boundary=experience",
      },
      payload: uploadBody(),
    });
  const first = await upload("experience-image-1");
  expect(first.statusCode).toBe(201);
  const reference = mediaReferenceContract.parse(first.json());
  expect((await upload("experience-image-1")).json()).toEqual(reference);
  const changedImage = await sharp({
    create: { width: 2, height: 2, channels: 4, background: "#A41439" },
  })
    .png()
    .toBuffer();
  const conflict = await server.inject({
    method: "POST",
    url: `/v1/purchase-experience-media/${context.contextId}`,
    headers: {
      cookie: buyer.cookie,
      "idempotency-key": "experience-image-1",
      "content-type": "multipart/form-data; boundary=experience",
    },
    payload: uploadBody(changedImage),
  });
  expect(conflict.statusCode).toBe(409);

  const privatePreview = await server.inject({
    method: "GET",
    url: reference.url,
    headers: { cookie: buyer.cookie },
  });
  expect(privatePreview.statusCode).toBe(200);
  expect(privatePreview.headers["cache-control"]).toBe("private, no-store");
  expect(
    (
      await server.inject({
        method: "GET",
        url: reference.url,
        headers: { cookie: other.cookie },
      })
    ).statusCode,
  ).toBe(404);
  await expect(
    media.checkReadyForPublication({
      identityId: buyer.identityId,
      orderItemId,
      mediaIds: [reference.id],
    }),
  ).resolves.toBe(true);
  await expect(
    media.checkReadyForPublication({
      identityId: buyer.identityId,
      orderItemId: randomUUID(),
      mediaIds: [reference.id],
    }),
  ).resolves.toBe(false);

  for (let index = 1; index < PURCHASE_EXPERIENCE_MEDIA_MAX_ITEMS; index += 1) {
    expect((await upload(`experience-image-${index + 1}`)).statusCode).toBe(201);
  }
  const overLimit = await upload("experience-image-over-limit");
  expect(overLimit.statusCode).toBe(422);
  expect(overLimit.json()).toMatchObject({
    code: "VALIDATION_ERROR",
    details: { issues: [{ field: "media", code: "TOO_MANY_FILES" }] },
  });
});

it("hides upload contexts and previews from a different or anonymous identity", async () => {
  const fixture = await createMediaTestApp(
    { ...apiTestEnvironment, DEV_OTP_TEST_MOBILES: undefined },
    async () => false,
    async () => false,
    async () => true,
  );
  apps.push(fixture);
  const server = fixture.app.getHttpAdapter().getInstance();
  const buyer = await signIn(server, "09123456789");
  const other = await signIn(server, "09123456780");
  const media = fixture.app.get<PurchaseExperienceMedia>(PURCHASE_EXPERIENCE_MEDIA);
  const context = await media.issueUploadContext({
    identityId: buyer.identityId,
    orderItemId: randomUUID(),
  });
  const request = (cookie?: string) =>
    server.inject({
      method: "POST",
      url: `/v1/purchase-experience-media/${context.contextId}`,
      headers: {
        ...(cookie ? { cookie } : {}),
        "idempotency-key": "unauthorized-upload",
        "content-type": "multipart/form-data; boundary=experience",
      },
      payload: uploadBody(),
    });
  expect((await request()).statusCode).toBe(401);
  expect((await request(other.cookie)).statusCode).toBe(404);
});

it("revokes upload and private preview when purchase eligibility ends", async () => {
  let eligible = true;
  const fixture = await createMediaTestApp(
    { ...apiTestEnvironment, DEV_OTP_TEST_MOBILES: undefined },
    async () => false,
    async () => false,
    async () => eligible,
  );
  apps.push(fixture);
  const server = fixture.app.getHttpAdapter().getInstance();
  const buyer = await signIn(server, "09123456789");
  const media = fixture.app.get<PurchaseExperienceMedia>(PURCHASE_EXPERIENCE_MEDIA);
  const context = await media.issueUploadContext({
    identityId: buyer.identityId,
    orderItemId: randomUUID(),
  });
  const upload = () =>
    server.inject({
      method: "POST",
      url: `/v1/purchase-experience-media/${context.contextId}`,
      headers: {
        cookie: buyer.cookie,
        "idempotency-key": "revoked-experience-image",
        "content-type": "multipart/form-data; boundary=experience",
      },
      payload: uploadBody(),
    });

  const created = await upload();
  expect(created.statusCode).toBe(201);
  const reference = mediaReferenceContract.parse(created.json());

  eligible = false;
  expect((await upload()).statusCode).toBe(404);
  expect(
    (
      await server.inject({
        method: "GET",
        url: reference.url,
        headers: { cookie: buyer.cookie },
      })
    ).statusCode,
  ).toBe(404);
});
