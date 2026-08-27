import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterEach, expect, it, vi } from "vitest";
import { conversationThreadV1Contract } from "@sevo/contracts/conversations/v1";
import { createApiApp } from "../../apps/api/src/create-app";
import {
  MEDIA_STORAGE,
  type MediaStorage,
  type StoredMedia,
} from "../../apps/api/src/modules/media/public";
import { apiTestEnvironment } from "../helpers/api-test-environment";

const fixtures: Awaited<ReturnType<typeof start>>[] = [];
afterEach(async () => {
  for (const f of fixtures.splice(0)) {
    await f.app.close();
    const [tables] = await f.sql`select to_regclass('conversation_threads') as present`;
    if (tables?.present)
      await f.sql`delete from conversation_threads where store_id = ${f.storeId}`;
    await f.sql`delete from order_orders where store_id = ${f.storeId}`;
    await f.sql`delete from order_checkout_preparations where cart_id in (select id from order_carts where store_id = ${f.storeId})`;
    await f.sql`delete from order_carts where store_id = ${f.storeId}`;
    await f.sql`delete from product_products where store_id = ${f.storeId}`;
    await f.sql`delete from store_stores where id = ${f.storeId}`;
    await f.sql`delete from identity_seller_access where id = ${f.grantId}`;
    await f.sql`update identity_identities set status = 'ACTIVE' where id in (${f.buyer.identityId}, ${f.seller.identityId}, ${f.other.identityId})`;
    await f.sql.end();
  }
});
async function start() {
  const app = await createApiApp({
    ...apiTestEnvironment,
    DEV_OTP_TEST_MOBILES: undefined,
  });
  const server = app.getHttpAdapter().getInstance();
  const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 3 });
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
    return { cookie, identityId: session.json().actor.identityId as string };
  }
  const buyer = await signIn("09123456781");
  const seller = await signIn("09123456782");
  const other = await signIn("09123456783");
  const storeId = randomUUID(),
    grantId = randomUUID();
  await sql`insert into store_stores (id, name, status, revision, publication_version, published_at) values (${storeId}, 'فروشگاه آزمون', 'PUBLISHED', 1, 1, now())`;
  await sql`insert into store_memberships (id, store_id, seller_id, role) values (${randomUUID()}, ${storeId}, ${seller.identityId}, 'OWNER')`;
  await sql`insert into identity_seller_access (id, identity_id, status) values (${grantId}, ${seller.identityId}, 'ACTIVE')`;
  const open = (
    key = randomUUID(),
    context: unknown = { kind: "STORE", storeId },
    cookie = buyer.cookie,
  ) =>
    server.inject({
      method: "POST",
      url: "/v1/conversations",
      headers: { cookie, "idempotency-key": key },
      payload: { context },
    });
  return { app, server, sql, buyer, seller, other, storeId, grantId, open };
}
async function fixture() {
  const f = await start();
  fixtures.push(f);
  return f;
}

it("opens one stable private thread for the same buyer, seller and store", async () => {
  const f = await fixture();
  const key = randomUUID();
  const opened = await f.open(key);
  expect(opened.statusCode).toBe(200);
  const thread = conversationThreadV1Contract.parse(opened.json());
  expect((await f.open(key)).json()).toEqual(thread);
  expect((await f.open()).json().conversationId).toBe(thread.conversationId);
  const sellerView = await f.server.inject({
    method: "GET",
    url: `/v1/conversations/${thread.conversationId}`,
    headers: { cookie: f.seller.cookie },
  });
  expect(sellerView.statusCode).toBe(200);
  expect(sellerView.json().viewerRole).toBe("SELLER");
});

it("sends one private message for repeated requests with the same key", async () => {
  const f = await fixture();
  const thread = (await f.open()).json();
  const key = randomUUID();
  const send = (text: string, cookie = f.buyer.cookie) =>
    f.server.inject({
      method: "POST",
      url: `/v1/conversations/${thread.conversationId}/messages`,
      headers: { cookie, "idempotency-key": key },
      payload: { content: { type: "TEXT", text } },
    });
  const sent = await send("سلام، این کالا موجود است؟");
  expect(sent.statusCode).toBe(201);
  expect((await send("سلام، این کالا موجود است؟")).json()).toEqual(sent.json());
  expect((await send("متن متفاوت")).json().code).toBe("IDEMPOTENCY_CONFLICT");
  expect((await send("پیام نامرتبط", f.other.cookie)).statusCode).toBe(403);
});

it("paginates a frozen message snapshot and rejects actor, thread and operation cursor reuse", async () => {
  const f = await fixture();
  const thread = (await f.open()).json();
  async function send(text: string) {
    return f.server.inject({
      method: "POST",
      url: `/v1/conversations/${thread.conversationId}/messages`,
      headers: { cookie: f.buyer.cookie, "idempotency-key": randomUUID() },
      payload: { content: { type: "TEXT", text } },
    });
  }
  const first = (await send("پیام اول")).json();
  const second = (await send("پیام دوم")).json();
  const url = `/v1/conversations/${thread.conversationId}/messages?limit=1`;
  const page = await f.server.inject({
    method: "GET",
    url,
    headers: { cookie: f.buyer.cookie },
  });
  expect(page.statusCode).toBe(200);
  expect(
    page.json().items.map((item: { messageId: string }) => item.messageId),
  ).toEqual([second.messageId]);
  await send("پیام تازه خارج از پیمایش");
  const cursor = encodeURIComponent(page.json().nextCursor);
  const next = await f.server.inject({
    method: "GET",
    url: `${url}&cursor=${cursor}`,
    headers: { cookie: f.buyer.cookie },
  });
  expect(
    next.json().items.map((item: { messageId: string }) => item.messageId),
  ).toEqual([first.messageId]);
  expect(next.json().nextCursor).toBeUndefined();
  expect(
    (
      await f.server.inject({
        method: "GET",
        url: `${url}&cursor=${cursor}`,
        headers: { cookie: f.seller.cookie },
      })
    ).json().code,
  ).toBe("INVALID_CURSOR");
  expect(
    (
      await f.server.inject({
        method: "GET",
        url: `/v1/conversations?cursor=${cursor}`,
        headers: { cookie: f.buyer.cookie },
      })
    ).json().code,
  ).toBe("INVALID_CURSOR");
});

it("delivers a private attachment to the other participant only after the message is sent", async () => {
  const f = await fixture();
  const thread = (await f.open()).json();
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  );
  const uploaded = await f.server.inject({
    method: "POST",
    url: `/v1/conversations/${thread.conversationId}/media`,
    headers: {
      cookie: f.buyer.cookie,
      "content-type": "multipart/form-data; boundary=attachment",
    },
    payload: Buffer.concat([
      Buffer.from(
        '--attachment\r\nContent-Disposition: form-data; name="file"; filename="image.png"\r\nContent-Type: image/png\r\n\r\n',
      ),
      png,
      Buffer.from("\r\n--attachment--\r\n"),
    ]),
  });
  expect(uploaded.statusCode).toBe(201);
  const media = uploaded.json();
  const read = (cookie: string) =>
    f.server.inject({ method: "GET", url: media.url, headers: { cookie } });
  expect((await read(f.seller.cookie)).statusCode).toBe(404);
  const sent = await f.server.inject({
    method: "POST",
    url: `/v1/conversations/${thread.conversationId}/messages`,
    headers: { cookie: f.buyer.cookie, "idempotency-key": randomUUID() },
    payload: { content: { type: "MEDIA", mediaId: media.id, caption: "تصویر کالا" } },
  });
  expect(sent.statusCode).toBe(201);
  expect((await read(f.seller.cookie)).statusCode).toBe(200);
  expect((await read(f.other.cookie)).statusCode).toBe(404);
  await f.sql`update identity_seller_access set status = 'SUSPENDED' where id = ${f.grantId}`;
  expect((await read(f.seller.cookie)).statusCode).toBe(404);
});

async function send(
  f: Awaited<ReturnType<typeof fixture>>,
  conversationId: string,
  text = "پیام آزمون",
  key = randomUUID(),
  cookie = f.buyer.cookie,
) {
  return f.server.inject({
    method: "POST",
    url: `/v1/conversations/${conversationId}/messages`,
    headers: { cookie, "idempotency-key": key },
    payload: { content: { type: "TEXT", text } },
  });
}
async function order(
  f: Awaited<ReturnType<typeof fixture>>,
  identityId = f.buyer.identityId,
  storeId = f.storeId,
) {
  const orderId = randomUUID(),
    checkoutId = randomUUID(),
    cartId = randomUUID();
  await f.sql`insert into order_carts (id, store_id, identity_id, status, revision, expires_at) values (${cartId}, ${storeId}, ${identityId}, 'CONVERTED', 1, now() + interval '1 day')`;
  await f.sql`insert into order_checkout_preparations (checkout_revision, identity_id, cart_id, cart_revision, shipping_method_id, shipping_revision, policy_revision, snapshot, expires_at) values (${checkoutId}, ${identityId}, ${cartId}, 1, ${randomUUID()}, 1, 1, '{}', now() + interval '1 day')`;
  await f.sql`insert into order_orders (id, identity_id, store_id, checkout_revision, reservation_id, total_amount, reservation_expires_at, review_snapshot) values (${orderId}, ${identityId}, ${storeId}, ${checkoutId}, ${randomUUID()}, 1000, now(), '{}')`;
  return { kind: "ORDER" as const, orderId, storeId };
}

it("checks authoritative order ownership and store while keeping historical buyer access", async () => {
  const f = await fixture();
  const own = await order(f);
  const other = await order(f, f.other.identityId);
  expect((await f.open(randomUUID(), other)).json().code).toBe("FORBIDDEN_CONTEXT");
  expect(
    (await f.open(randomUUID(), { ...own, orderId: randomUUID() })).json().code,
  ).toBe("FORBIDDEN_CONTEXT");
  await f.sql`update store_stores set status = 'DRAFT' where id = ${f.storeId}`;
  expect((await f.open()).json().code).toBe("CONTEXT_UNAVAILABLE");
  const opened = await f.open(randomUUID(), own);
  expect(opened.statusCode).toBe(200);
  const id = opened.json().conversationId;
  await f.sql`update identity_seller_access set status = 'SUSPENDED' where id = ${f.grantId}`;
  expect(
    (
      await f.server.inject({
        method: "GET",
        url: `/v1/conversations/${id}`,
        headers: { cookie: f.buyer.cookie },
      })
    ).statusCode,
  ).toBe(200);
  expect(
    (await send(f, id, "پاسخ فروشنده", randomUUID(), f.seller.cookie)).json().code,
  ).toBe("FORBIDDEN_CONVERSATION");
  expect(
    (
      await f.server.inject({
        method: "GET",
        url: "/v1/conversations",
        headers: { cookie: f.seller.cookie },
      })
    ).json().items,
  ).toEqual([]);
});

it("allows only published products belonging to the contextual store", async () => {
  const f = await fixture();
  const productId = randomUUID(),
    variantId = randomUUID(),
    mediaId = randomUUID();
  const price = { amount: 1000, currency: "IRR" };
  const snapshot = {
    productId,
    name: "کالای آزمون",
    description: "",
    images: [{ id: mediaId, url: `/v1/media/${mediaId}` }],
    axes: [],
    variants: [{ variantId, combination: [], price, availability: "AVAILABLE" }],
    priceRange: { minimum: price, maximum: price },
    availability: "AVAILABLE",
    publicationVersion: 1,
  };
  await f.sql`insert into product_products (id, store_id, state, revision, publication_version, published_at) values (${productId}, ${f.storeId}, 'PUBLISHED', 1, 1, now())`;
  await f.sql`insert into product_publications (product_id, publication_version, name, description, media_id, variant_id, snapshot) values (${productId}, 1, 'کالای آزمون', '', ${mediaId}, ${variantId}, ${f.sql.json(snapshot)})`;
  const context = { kind: "PRODUCT", storeId: f.storeId, productId };
  expect((await f.open(randomUUID(), context)).statusCode).toBe(200);
  await f.sql`update product_products set store_id = ${randomUUID()} where id = ${productId}`;
  expect((await f.open(randomUUID(), context)).json().code).toBe("CONTEXT_UNAVAILABLE");
  await f.sql`update product_products set store_id = ${f.storeId}, state = 'DRAFT' where id = ${productId}`;
  expect((await f.open(randomUUID(), context)).json().code).toBe("CONTEXT_UNAVAILABLE");
});

it("rechecks session and participant authorization even for idempotency replay and direct URLs", async () => {
  const f = await fixture();
  expect(
    (await f.server.inject({ method: "GET", url: "/v1/conversations" })).json().code,
  ).toBe("UNAUTHENTICATED");
  expect(
    (
      await f.open(randomUUID(), { kind: "STORE", storeId: f.storeId }, f.seller.cookie)
    ).json().code,
  ).toBe("FORBIDDEN_CONTEXT");
  const thread = (await f.open()).json(),
    key = randomUUID();
  expect((await send(f, thread.conversationId, "سلام", key)).statusCode).toBe(201);
  for (const suffix of ["", "/messages"])
    expect(
      (
        await f.server.inject({
          method: "GET",
          url: `/v1/conversations/${thread.conversationId}${suffix}`,
          headers: { cookie: f.other.cookie },
        })
      ).json().code,
    ).toBe("FORBIDDEN_CONVERSATION");
  await f.sql`update identity_identities set status = 'SUSPENDED' where id = ${f.buyer.identityId}`;
  expect((await send(f, thread.conversationId, "سلام", key)).json().code).toBe(
    "IDENTITY_INACTIVE",
  );
  expect(
    (
      await f.server.inject({
        method: "GET",
        url: "/v1/conversations",
        headers: { cookie: f.buyer.cookie },
      })
    ).json().code,
  ).toBe("IDENTITY_INACTIVE");
});

it("does not let private thread or message responses enter caches", async () => {
  const f = await fixture();
  const opened = await f.open();
  const id = opened.json().conversationId;
  const responses = [opened, await send(f, id)];
  for (const path of ["", `/${id}`, `/${id}/messages`])
    responses.push(
      await f.server.inject({
        method: "GET",
        url: `/v1/conversations${path}`,
        headers: { cookie: f.buyer.cookie },
      }),
    );
  for (const response of responses)
    expect(response.headers["cache-control"]).toBe("private, no-store");
});

it("freezes thread ordering across new activity and rejects malformed or expired cursors", async () => {
  const f = await fixture();
  const first = (await f.open()).json();
  const second = (await f.open(randomUUID(), await order(f))).json();
  await send(f, second.conversationId);
  const get = (query: string) =>
    f.server.inject({
      method: "GET",
      url: `/v1/conversations?${query}`,
      headers: { cookie: f.buyer.cookie },
    });
  const page = (await get("limit=1")).json();
  expect(page.items[0].conversationId).toBe(second.conversationId);
  await send(f, first.conversationId);
  const next = (
    await get(`limit=1&cursor=${encodeURIComponent(page.nextCursor)}`)
  ).json();
  expect(
    next.items.map((item: { conversationId: string }) => item.conversationId),
  ).toEqual([first.conversationId]);
  expect(next.items[0].updatedAt).toBe(first.updatedAt);
  for (const query of [
    "limit=0",
    "limit=51",
    "cursor=garbled",
    `cursor=${page.nextCursor}x`,
  ])
    expect((await get(query)).json().code).toBe("INVALID_CURSOR");
  await f.sql`update conversation_snapshots set expires_at = now() - interval '1 second' where identity_id = ${f.buyer.identityId}`;
  expect((await get(`cursor=${page.nextCursor}`)).json().code).toBe("CURSOR_EXPIRED");
});

it("returns retry metadata for an in-progress key then commits exactly one private event and audit", async () => {
  const f = await fixture();
  const thread = (await f.open()).json(),
    key = randomUUID();
  await f.sql.begin(async (sql) => {
    await sql`select pg_advisory_xact_lock(hashtextextended(${`send:${f.buyer.identityId}:${thread.conversationId}:${key}`}, 0))`;
    const busy = await send(f, thread.conversationId, "محتوای خصوصی آزمون", key);
    expect(busy.statusCode).toBe(409);
    expect(busy.json()).toMatchObject({
      code: "IDEMPOTENCY_IN_PROGRESS",
      details: { retryAfterSeconds: 1 },
    });
    expect(busy.headers["retry-after"]).toBe("1");
  });
  const sent = await send(f, thread.conversationId, "محتوای خصوصی آزمون", key);
  expect(sent.statusCode).toBe(201);
  expect(
    (await send(f, thread.conversationId, "محتوای خصوصی آزمون", key)).json(),
  ).toEqual(sent.json());
  const events =
    await f.sql`select payload from platform_outbox_events where aggregate_id = ${thread.conversationId} and event_type = 'MessageSent.v1'`;
  expect(events).toEqual([
    {
      payload: {
        conversationId: thread.conversationId,
        messageId: sent.json().messageId,
        contextKind: "STORE",
        senderRole: "BUYER",
      },
    },
  ]);
  const audits =
    await f.sql`select * from conversation_audits where conversation_id = ${thread.conversationId} and operation = 'SendMessage.v1'`;
  expect(audits).toHaveLength(1);
  expect(JSON.stringify(audits)).not.toContain("محتوای خصوصی آزمون");
  expect(JSON.stringify(audits)).not.toContain(f.buyer.cookie);
});

it("rolls back message, audit and idempotency when outbox persistence fails, allowing a safe retry", async () => {
  const f = await fixture();
  const thread = (await f.open()).json(),
    key = randomUUID();
  // A per-thread constraint injects a real PostgreSQL write failure without affecting other aggregates.
  await f.sql.unsafe(
    `alter table platform_outbox_events add constraint conversation_test_failure check (aggregate_id <> '${conversationThreadV1Contract.parse(thread).conversationId}'::uuid) not valid`,
  );
  try {
    expect(
      (await send(f, thread.conversationId, "پیام قابل تلاش دوباره", key)).statusCode,
    ).toBe(500);
    expect(
      await f.sql`select id from conversation_messages where conversation_id = ${thread.conversationId}`,
    ).toHaveLength(0);
    expect(
      await f.sql`select id from conversation_audits where conversation_id = ${thread.conversationId} and operation = 'SendMessage.v1'`,
    ).toHaveLength(0);
    expect(
      await f.sql`select key from conversation_idempotency where scope = ${`send:${f.buyer.identityId}:${thread.conversationId}`} and key = ${key}`,
    ).toHaveLength(0);
  } finally {
    await f.sql`alter table platform_outbox_events drop constraint conversation_test_failure`;
  }
  expect(
    (await send(f, thread.conversationId, "پیام قابل تلاش دوباره", key)).statusCode,
  ).toBe(201);
});

it("rejects wrong-owner and wrong-thread media and retries an unready attachment without duplicate persistence", async () => {
  const f = await fixture();
  const thread = (await f.open()).json();
  const storage = f.app.get<MediaStorage>(MEDIA_STORAGE);
  const mediaId = randomUUID(),
    key = randomUUID();
  const media: StoredMedia = {
    key: mediaId,
    purpose: "CONVERSATION_ATTACHMENT",
    contentType: "image/png",
    bytes: new Uint8Array([1]),
    checksum: "test",
    width: 1,
    height: 1,
    variants: [],
    ownerSellerId: f.buyer.identityId,
    ownerReferenceId: thread.conversationId,
    visibility: "PRIVATE",
  };
  const submit = () =>
    f.server.inject({
      method: "POST",
      url: `/v1/conversations/${thread.conversationId}/messages`,
      headers: { cookie: f.buyer.cookie, "idempotency-key": key },
      payload: { content: { type: "MEDIA", mediaId, caption: "تصویر خصوصی" } },
    });
  expect((await submit()).json().code).toBe("MESSAGE_REJECTED");
  await storage.put({ ...media, ownerSellerId: f.seller.identityId });
  expect((await submit()).json().code).toBe("MESSAGE_REJECTED");
  await storage.put({ ...media, ownerReferenceId: randomUUID() });
  expect((await submit()).json().code).toBe("MESSAGE_REJECTED");
  await storage.put(media);
  expect((await submit()).json().code).toBe("MEDIA_NOT_READY");
  expect(
    await f.sql`select id from conversation_messages where conversation_id = ${thread.conversationId}`,
  ).toHaveLength(0);
  await storage.put({
    ...media,
    variants: [
      {
        key: randomUUID(),
        name: "attachment-preview",
        contentType: "image/webp",
        bytes: new Uint8Array([1]),
        width: 1,
        height: 1,
      },
    ],
  });
  const sent = await submit();
  expect(sent.statusCode).toBe(201);
  expect((await submit()).json()).toEqual(sent.json());
  const events =
    await f.sql`select payload from platform_outbox_events where aggregate_id = ${thread.conversationId}`;
  expect(events).toHaveLength(1);
  expect(JSON.stringify(events)).not.toContain(mediaId);
  expect(JSON.stringify(events)).not.toContain("تصویر خصوصی");
});

it("deduplicates concurrent opens with different keys and rejects conflicting open payloads", async () => {
  const f = await fixture();
  const key = randomUUID();
  const responses = await Promise.all([f.open(key), f.open(), f.open()]);
  expect(responses.map((r) => r.statusCode)).toEqual([200, 200, 200]);
  expect(new Set(responses.map((r) => r.json().conversationId)).size).toBe(1);
  expect((await f.open(key, await order(f))).json().code).toBe("IDEMPOTENCY_CONFLICT");
});

it("does not reuse a messages cursor in another accessible conversation", async () => {
  const f = await fixture();
  const first = (await f.open()).json(),
    second = (await f.open(randomUUID(), await order(f))).json();
  await send(f, first.conversationId);
  await send(f, first.conversationId);
  const page = (
    await f.server.inject({
      method: "GET",
      url: `/v1/conversations/${first.conversationId}/messages?limit=1`,
      headers: { cookie: f.buyer.cookie },
    })
  ).json();
  const response = await f.server.inject({
    method: "GET",
    url: `/v1/conversations/${second.conversationId}/messages?cursor=${page.nextCursor}`,
    headers: { cookie: f.buyer.cookie },
  });
  expect(response.statusCode).toBe(400);
  expect(response.json().code).toBe("INVALID_CURSOR");
});

it("replays a successful open after publication eligibility changes", async () => {
  const f = await fixture(),
    key = randomUUID();
  const opened = await f.open(key);
  expect(opened.statusCode).toBe(200);
  await f.sql`update store_stores set status = 'DRAFT' where id = ${f.storeId}`;
  const replay = await f.open(key);
  expect(replay.statusCode).toBe(200);
  expect(replay.json()).toEqual(opened.json());
  expect((await f.open()).json().code).toBe("CONTEXT_UNAVAILABLE");
});

it("canonicalizes UUID spelling before idempotency and cursor binding", async () => {
  const f = await fixture(),
    key = randomUUID();
  const opened = await f.open(key);
  expect(
    (await f.open(key, { kind: "STORE", storeId: f.storeId.toUpperCase() })).json(),
  ).toEqual(opened.json());
  const id = opened.json().conversationId,
    sendKey = randomUUID();
  const sent = await send(f, id, "یک پیام", sendKey);
  expect((await send(f, id.toUpperCase(), "یک پیام", sendKey)).json()).toEqual(
    sent.json(),
  );
  expect(
    await f.sql`select id from conversation_messages where conversation_id = ${id}`,
  ).toHaveLength(1);
});

it("does not hold a thread transaction during attachment I/O and rechecks access afterwards", async () => {
  const f = await fixture();
  const id = (await f.open()).json().conversationId,
    mediaId = randomUUID();
  const storage = f.app.get<MediaStorage>(MEDIA_STORAGE);
  await storage.put({
    key: mediaId,
    purpose: "CONVERSATION_ATTACHMENT",
    contentType: "image/png",
    bytes: new Uint8Array([1]),
    checksum: "test",
    width: 1,
    height: 1,
    ownerSellerId: f.buyer.identityId,
    ownerReferenceId: id,
    visibility: "PRIVATE",
    variants: [
      {
        key: randomUUID(),
        name: "attachment-preview",
        contentType: "image/webp",
        bytes: new Uint8Array([1]),
        width: 1,
        height: 1,
      },
    ],
  });
  let release = () => {},
    entered = () => {};
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const originalGet = storage.get.bind(storage);
  const get = vi.spyOn(storage, "get").mockImplementation(async (...args) => {
    entered();
    await barrier;
    return originalGet(...args);
  });
  const pending = f.server
    .inject({
      method: "POST",
      url: `/v1/conversations/${id}/messages`,
      headers: { cookie: f.buyer.cookie, "idempotency-key": randomUUID() },
      payload: { content: { type: "MEDIA", mediaId } },
    })
    .then((response) => response);
  await started;
  try {
    await f.sql.begin(async (sql) => {
      await sql`select id from conversation_threads where id = ${id} for update nowait`;
    });
    await f.sql`update identity_identities set status = 'SUSPENDED' where id = ${f.buyer.identityId}`;
  } finally {
    release();
    get.mockRestore();
  }
  expect((await pending).json().code).toBe("IDENTITY_INACTIVE");
  expect(
    await f.sql`select id from conversation_messages where conversation_id = ${id}`,
  ).toHaveLength(0);
});
