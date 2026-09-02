import { randomUUID } from "node:crypto";

import {
  BUYER_DISPUTE_MEDIA_MAX_ITEMS,
  mediaReferenceContract,
} from "@sevo/contracts/media/v1";
import { identityIdContract, orderIdContract } from "@sevo/contracts/platform/v1";
import type { FastifyInstance } from "fastify";
import { afterEach, expect, it } from "vitest";
import sharp from "sharp";

import { createMediaTestApp } from "../../apps/api/testing/create-media-test-app";
import {
  BUYER_DISPUTE_MEDIA,
  DISPUTE_EVIDENCE_READER,
  type BuyerDisputeMedia,
  type DisputeEvidenceReader,
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
      '--evidence\r\nContent-Disposition: form-data; name="file"; filename="evidence.png"\r\nContent-Type: image/png\r\n\r\n',
    ),
    image,
    Buffer.from("\r\n--evidence--\r\n"),
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

it("uploads and privately previews real buyer dispute evidence with safe retry", async () => {
  const fixture = await createMediaTestApp(
    { ...apiTestEnvironment, DEV_OTP_TEST_MOBILES: undefined },
    async () => false,
    async () => false,
    async () => false,
    async () => true,
  );
  apps.push(fixture);
  const server = fixture.app.getHttpAdapter().getInstance();
  const buyer = await signIn(server, "09123456789");
  const other = await signIn(server, "09123456780");
  const orderId = orderIdContract.parse(randomUUID());
  const media = fixture.app.get<BuyerDisputeMedia>(BUYER_DISPUTE_MEDIA);
  const context = await media.issueUploadContext({
    identityId: buyer.identityId,
    orderId,
  });

  const upload = (
    cookie: string,
    idempotencyKey = "buyer-dispute-image-1",
    image = png,
  ) =>
    server.inject({
      method: "POST",
      url: `/v1/buyer-dispute-media/${context.contextId}`,
      headers: {
        cookie,
        "idempotency-key": idempotencyKey,
        "content-type": "multipart/form-data; boundary=evidence",
      },
      payload: uploadBody(image),
    });
  const first = await upload(buyer.cookie);
  expect(first.statusCode).toBe(201);
  const reference = mediaReferenceContract.parse(first.json());
  expect((await upload(buyer.cookie)).json()).toEqual(reference);
  const changedImage = await sharp({
    create: { width: 2, height: 2, channels: 4, background: "#A41439" },
  })
    .png()
    .toBuffer();
  expect(
    (await upload(buyer.cookie, "buyer-dispute-image-1", changedImage)).statusCode,
  ).toBe(409);
  expect((await upload(other.cookie)).statusCode).toBe(404);

  const preview = await server.inject({
    method: "GET",
    url: reference.url,
    headers: { cookie: buyer.cookie },
  });
  expect(preview.statusCode).toBe(200);
  expect(preview.headers["cache-control"]).toBe("private, no-store");
  expect(
    (
      await server.inject({
        method: "GET",
        url: reference.url,
        headers: { cookie: other.cookie },
      })
    ).statusCode,
  ).toBe(404);
  const evidence = fixture.app.get<DisputeEvidenceReader>(DISPUTE_EVIDENCE_READER);
  await expect(
    evidence.isReadyBuyerEvidence({
      identityId: buyer.identityId,
      orderId,
      evidenceId: reference.id,
      kind: "IMAGE",
    }),
  ).resolves.toBe("READY");

  const limitContext = await media.issueUploadContext({
    identityId: other.identityId,
    orderId: orderIdContract.parse(randomUUID()),
  });
  const uploadForLimit = (idempotencyKey: string) =>
    server.inject({
      method: "POST",
      url: `/v1/buyer-dispute-media/${limitContext.contextId}`,
      headers: {
        cookie: other.cookie,
        "idempotency-key": idempotencyKey,
        "content-type": "multipart/form-data; boundary=evidence",
      },
      payload: uploadBody(),
    });
  for (let index = 0; index < BUYER_DISPUTE_MEDIA_MAX_ITEMS; index += 1) {
    expect((await uploadForLimit(`buyer-dispute-limit-${index + 1}`)).statusCode).toBe(
      201,
    );
  }
  expect((await uploadForLimit("buyer-dispute-image-over-limit")).statusCode).toBe(422);
});
