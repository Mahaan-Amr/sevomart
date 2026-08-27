import { randomUUID } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import { createMediaTestApp } from "../../apps/api/src/modules/media/testing/create-media-test-app";
import { conversationAttachmentInputContract } from "@sevo/contracts/media/v1";
import {
  CONVERSATION_ATTACHMENT_READER,
  type ConversationAttachmentReader,
} from "../../apps/api/src/modules/media/public";
import { apiTestEnvironment } from "../helpers/api-test-environment";

const apps: Awaited<ReturnType<typeof createMediaTestApp>>[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map(({ app }) => app.close()));
});
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
function uploadBody() {
  return Buffer.concat([
    Buffer.from(
      '--attachment\r\nContent-Disposition: form-data; name="file"; filename="image.png"\r\nContent-Type: image/png\r\n\r\n',
    ),
    png,
    Buffer.from("\r\n--attachment--\r\n"),
  ]);
}
async function start() {
  const conversationId = randomUUID();
  const members = new Set<string>();
  const sent = new Set<string>();
  const fixture = await createMediaTestApp(
    { ...apiTestEnvironment, DEV_OTP_TEST_MOBILES: undefined },
    async (input) =>
      input.conversationId === conversationId &&
      members.has(input.identityId) &&
      (!input.mediaId || sent.has(input.mediaId)),
  );
  apps.push(fixture);
  const server = fixture.app.getHttpAdapter().getInstance();
  async function signIn(mobile: string) {
    const request = await server.inject({
      method: "POST",
      url: "/v1/auth/otp/requests",
      payload: { mobile },
    });
    const verification = await server.inject({
      method: "POST",
      url: "/v1/auth/otp/verifications",
      payload: { challengeId: request.json().challengeId, code: "111111" },
    });
    const cookie = verification.headers["set-cookie"]!;
    const session = await server.inject({
      method: "GET",
      url: "/v1/auth/session",
      headers: { cookie },
    });
    return { cookie, identityId: session.json().actor.identityId as string };
  }
  const { cookie, identityId } = await signIn("09123456789");
  members.add(identityId);
  const upload = () =>
    server.inject({
      method: "POST",
      url: `/v1/conversations/${conversationId}/media`,
      headers: { cookie, "content-type": "multipart/form-data; boundary=attachment" },
      payload: uploadBody(),
    });
  return {
    ...fixture,
    signIn,
    server,
    conversationId,
    members,
    sent,
    cookie,
    identityId,
    upload,
  };
}

it("uploads a private conversation image for its active participant", async () => {
  const fixture = await start();
  const response = await fixture.upload();
  expect(response.statusCode).toBe(201);
  const reference = response.json();
  const preview = await fixture.server.inject({
    method: "GET",
    url: reference.url,
    headers: { cookie: fixture.cookie },
  });
  expect(preview.statusCode).toBe(200);
  expect(preview.headers["cache-control"]).toBe("private, no-store");
});

it("shares only sent attachments with the other active participant and denies direct URLs after revocation", async () => {
  const f = await start();
  const reference = (await f.upload()).json();
  const other = await f.signIn("09123456780");
  const read = (cookie?: string) =>
    f.server.inject({
      method: "GET",
      url: reference.url,
      headers: cookie ? { cookie } : {},
    });
  expect((await read()).statusCode).toBe(401);
  expect((await read(other.cookie)).statusCode).toBe(404);
  f.members.add(other.identityId);
  expect((await read(other.cookie)).statusCode).toBe(404);
  f.sent.add(reference.id);
  expect((await read(other.cookie)).statusCode).toBe(200);
  f.members.delete(other.identityId);
  expect((await read(other.cookie)).statusCode).toBe(404);
  f.members.delete(f.identityId);
  expect((await read(f.cookie)).statusCode).toBe(404);
  expect((await f.upload()).statusCode).toBe(404);
});

it("checks owner, thread, purpose and readiness through the public media interface", async () => {
  const f = await start();
  const reference = (await f.upload()).json();
  const reader = f.app.get<ConversationAttachmentReader>(
    CONVERSATION_ATTACHMENT_READER,
  );
  const input = conversationAttachmentInputContract.parse({
    identityId: f.identityId,
    conversationId: f.conversationId,
    mediaId: reference.id,
  });
  expect(await reader.checkConversationAttachment(input)).toBe("READY");
  for (const field of ["identityId", "conversationId", "mediaId"] as const) {
    expect(
      await reader.checkConversationAttachment(
        conversationAttachmentInputContract.parse({ ...input, [field]: randomUUID() }),
      ),
    ).toBe("MESSAGE_REJECTED");
  }
  await expect(f.storage.makePublic(reference.id, f.identityId)).rejects.toThrow();
  expect((await f.storage.inspect(reference.id))?.visibility).toBe("PRIVATE");
});

it("denies uploads to another thread, invalid images and anonymous requests", async () => {
  const f = await start();
  const headers = {
    cookie: f.cookie,
    "content-type": "multipart/form-data; boundary=attachment",
  };
  expect(
    (
      await f.server.inject({
        method: "POST",
        url: `/v1/conversations/${randomUUID()}/media`,
        headers,
        payload: uploadBody(),
      })
    ).statusCode,
  ).toBe(404);
  expect(
    (
      await f.server.inject({
        method: "POST",
        url: `/v1/conversations/${f.conversationId}/media`,
        headers: { "content-type": headers["content-type"] },
        payload: uploadBody(),
      })
    ).statusCode,
  ).toBe(401);
  const broken = Buffer.from(
    uploadBody().toString("latin1").replace(png.toString("latin1"), "not an image"),
    "latin1",
  );
  expect(
    (
      await f.server.inject({
        method: "POST",
        url: `/v1/conversations/${f.conversationId}/media`,
        headers,
        payload: broken,
      })
    ).statusCode,
  ).toBe(422);
});
