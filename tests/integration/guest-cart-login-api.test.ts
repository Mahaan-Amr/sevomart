import {
  cartContract,
  cartErrorContract,
  cartResolutionContract,
} from "@sevo/contracts/orders/v1";
import { createHash } from "node:crypto";
import postgres from "postgres";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApiApp } from "../../apps/api/src/create-app";
import { apiTestEnvironment } from "../helpers/api-test-environment";

describe("guest cart and login attachment HTTP API", () => {
  const apps: Awaited<ReturnType<typeof createApiApp>>[] = [];
  const storeId = "ad75d73c-1744-422c-a6ae-31195ed6abf1";
  const productId = "a78fdcc0-caad-4315-a7cd-b22834fe76d4";
  const variantId = "a3991ca0-50f6-44b9-a4b2-5ae917e5dac7";
  const mediaId = "807c619f-a989-4fd9-8b78-a437a07c7bc4";
  const other = {
    storeId: "7b7564df-b155-41fe-b7ab-e9af5076f264",
    productId: "1511ab0f-ad2a-49a5-9761-95986ea070af",
    variantId: "31b571c5-af12-44ce-98c0-bd3bf433f2ba",
    mediaId: "718c6093-1fc4-468e-a227-32859e83f61e",
  };

  beforeEach(async () => {
    const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
    await sql`delete from order_cart_audits`;
    await sql`delete from order_cart_idempotency_records`;
    await sql`delete from order_carts`;
    await sql`delete from inventory_levels`;
    await sql`
      delete from product_state_transitions
      where product_id in (${productId}::uuid, ${other.productId}::uuid)
    `;
    await sql`
      delete from product_products
      where id in (${productId}::uuid, ${other.productId}::uuid)
    `;
    await sql`
      delete from store_stores
      where id in (${storeId}::uuid, ${other.storeId}::uuid)
    `;
    await sql`
      insert into store_stores
        (id, name, slug, status, publication_version, revision, updated_at)
      values
        (${storeId}, 'خانه فنجان', 'cart-store', 'PUBLISHED', 1, 1, now())
    `;
    await sql`
      insert into store_memberships (id, store_id, seller_id, role)
      values (${crypto.randomUUID()}, ${storeId}, ${crypto.randomUUID()}, 'OWNER')
    `;
    await sql`
      insert into product_products
        (id, store_id, state, revision, publication_version, published_at)
      values (${productId}, ${storeId}, 'PUBLISHED', 2, 1, now())
    `;
    await sql`
      insert into product_publications
        (product_id, publication_version, name, description, media_id, variant_id)
      values
        (${productId}, 1, 'فنجان سرامیکی', 'فنجان دست‌ساز', ${mediaId}, ${variantId})
    `;
    await sql`
      insert into product_offers (product_id, variant_id, amount, currency, revision)
      values (${productId}, ${variantId}, 4500000, 'IRR', 1)
    `;
    await sql`
      insert into product_variants
        (id, product_id, store_id, client_key, combination_key)
      values (${variantId}, ${productId}, ${storeId}, 'simple', '')
    `;
    await sql`
      insert into inventory_levels (variant_id, store_id, on_hand, revision)
      values (${variantId}, ${storeId}, 8, 1)
    `;
    await sql`
      insert into store_stores
        (id, name, slug, status, publication_version, revision, updated_at)
      values
        (${other.storeId}, 'خانه پارچه', 'other-cart-store', 'PUBLISHED', 1, 1, now())
    `;
    await sql`
      insert into store_memberships (id, store_id, seller_id, role)
      values (${crypto.randomUUID()}, ${other.storeId}, ${crypto.randomUUID()}, 'OWNER')
    `;
    await sql`
      insert into product_products
        (id, store_id, state, revision, publication_version, published_at)
      values (${other.productId}, ${other.storeId}, 'PUBLISHED', 2, 1, now())
    `;
    await sql`
      insert into product_publications
        (product_id, publication_version, name, description, media_id, variant_id)
      values
        (${other.productId}, 1, 'شال دست‌باف', 'شال دست‌باف', ${other.mediaId},
         ${other.variantId})
    `;
    await sql`
      insert into product_offers (product_id, variant_id, amount, currency, revision)
      values (${other.productId}, ${other.variantId}, 3200000, 'IRR', 1)
    `;
    await sql`
      insert into product_variants
        (id, product_id, store_id, client_key, combination_key)
      values (${other.variantId}, ${other.productId}, ${other.storeId}, 'simple', '')
    `;
    await sql`
      insert into inventory_levels (variant_id, store_id, on_hand, revision)
      values (${other.variantId}, ${other.storeId}, 4, 1)
    `;
    await sql.end();
  });

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it("keeps a server-side guest cart across refresh and revalidates its display", async () => {
    const app = await createApiApp(apiTestEnvironment);
    apps.push(app);
    const server = app.getHttpAdapter().getInstance();
    const key = crypto.randomUUID();
    const guestScope = crypto.randomUUID();
    const missingScope = await server.inject({
      method: "PUT",
      url: `/v1/cart/items/${variantId}`,
      headers: { "idempotency-key": crypto.randomUUID() },
      payload: { variantId, quantity: 2, expectedRevision: 0 },
    });
    expect(missingScope.statusCode).toBe(422);
    expect(cartErrorContract.parse(missingScope.json())).toMatchObject({
      code: "GUEST_SCOPE_REQUIRED",
    });
    const added = await server.inject({
      method: "PUT",
      url: `/v1/cart/items/${variantId}`,
      headers: { "idempotency-key": key, "x-sevo-guest-scope": guestScope },
      payload: { variantId, quantity: 2, expectedRevision: 0 },
    });

    expect(added.statusCode).toBe(200);
    const cookie = added.headers["set-cookie"]!;
    expect(cookie).toContain("sevo_cart=");
    expect(cookie).toContain("HttpOnly");
    expect(JSON.stringify(added.json())).not.toMatch(/onHand|token|secret/i);
    expect(cartContract.parse(added.json()).items[0]).toMatchObject({
      quantity: 2,
      unitPrice: { amount: 4_500_000, currency: "IRR" },
      availability: "AVAILABLE",
    });

    const replay = await server.inject({
      method: "PUT",
      url: `/v1/cart/items/${variantId}`,
      headers: { "idempotency-key": key, "x-sevo-guest-scope": guestScope },
      payload: { variantId, quantity: 2, expectedRevision: 0 },
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual(added.json());
    expect(replay.headers["set-cookie"]).toBe(cookie);

    const unrelatedGuest = await server.inject({
      method: "PUT",
      url: `/v1/cart/items/${variantId}`,
      headers: {
        "idempotency-key": key,
        "x-sevo-guest-scope": crypto.randomUUID(),
      },
      payload: { variantId, quantity: 2, expectedRevision: 0 },
    });
    expect(unrelatedGuest.statusCode).toBe(200);
    expect(unrelatedGuest.json().cartId).not.toBe(added.json().cartId);
    expect(unrelatedGuest.headers["set-cookie"]).not.toBe(cookie);

    const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
    const secrets = await sql<Array<{ tokenHash: string }>>`
      select token_hash as "tokenHash" from order_cart_access_tokens
    `;
    const rawSecret = cookie.match(/sevo_cart=([^;]+)/)?.[1];
    expect(secrets[0]?.tokenHash).toHaveLength(64);
    expect(secrets[0]?.tokenHash).not.toBe(rawSecret);
    await sql`update product_offers set amount = 4700000, revision = 2`;
    await sql`update inventory_levels set on_hand = 0, revision = 2`;
    await sql.end();

    const refreshed = await server.inject({
      method: "GET",
      url: "/v1/cart",
      headers: { cookie },
    });
    expect(refreshed.statusCode).toBe(200);
    expect(cartContract.parse(refreshed.json().cart).items[0]).toMatchObject({
      unitPrice: { amount: 4_700_000, currency: "IRR" },
      availability: "OUT_OF_STOCK",
    });
  });

  it("replaces an expired guest secret instead of trusting or reusing it", async () => {
    const app = await createApiApp(apiTestEnvironment);
    apps.push(app);
    const server = app.getHttpAdapter().getInstance();
    const first = await add(server, undefined, 1, 0);
    const staleCookie = first.headers["set-cookie"]!;
    const staleSecret = staleCookie.match(/sevo_cart=([^;]+)/)?.[1];
    const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
    await sql`
      update order_cart_access_tokens set expires_at = now() - interval '1 minute'
    `;
    await sql.end();

    const fresh = await add(server, staleCookie, 2, 0);
    expect(fresh.statusCode, JSON.stringify(fresh.json())).toBe(200);
    const freshSecret = fresh.headers["set-cookie"]?.match(/sevo_cart=([^;]+)/)?.[1];
    expect(freshSecret).toBeTruthy();
    expect(freshSecret).not.toBe(staleSecret);
    expect(fresh.json()).toMatchObject({ revision: 1, items: [{ quantity: 2 }] });
  });

  it("attaches a guest cart after OTP login and idempotently merges duplicate lines", async () => {
    const app = await createApiApp(apiTestEnvironment);
    apps.push(app);
    const server = app.getHttpAdapter().getInstance();
    const guest = await add(server, undefined, 2, 0);
    expect(guest.statusCode, JSON.stringify(guest.json())).toBe(200);
    const guestCookie = guest.headers["set-cookie"]!;
    const sessionCookie = await signIn(server);

    const buyer = await add(server, sessionCookie, 3, 0);
    expect(buyer.statusCode, JSON.stringify(buyer.json())).toBe(200);
    const inspected = await server.inject({
      method: "POST",
      url: "/v1/cart/attach",
      headers: {
        cookie: `${sessionCookie}; ${guestCookie}`,
        "idempotency-key": crypto.randomUUID(),
      },
      payload: {},
    });
    expect(inspected.statusCode, JSON.stringify(inspected.json())).toBe(409);
    expect(inspected.json()).toHaveProperty("status", "RESOLUTION_REQUIRED");
    const conflict = cartResolutionContract.parse(inspected.json());
    expect(conflict.status).toBe("RESOLUTION_REQUIRED");
    if (conflict.status !== "RESOLUTION_REQUIRED") throw new Error("conflict expected");
    expect(conflict.conflict.kind).toBe("SAME_STORE");

    const resolveKey = crypto.randomUUID();
    const request = {
      method: "POST" as const,
      url: "/v1/cart/resolve",
      headers: {
        cookie: `${sessionCookie}; ${guestCookie}`,
        "idempotency-key": resolveKey,
      },
      payload: {
        decision: "MERGE",
        guestRevision: guest.json().revision,
        buyerRevision: buyer.json().revision,
      },
    };
    const merged = await server.inject(request);
    expect(merged.statusCode).toBe(200);
    expect(cartResolutionContract.parse(merged.json())).toMatchObject({
      status: "ATTACHED",
      cart: { revision: 2, items: [{ quantity: 5 }] },
    });
    const replayed = await server.inject(request);
    expect(replayed.statusCode).toBe(200);
    expect(replayed.json()).toEqual(merged.json());
  });

  it("idempotently audits direct guest cart attachment with its correlation", async () => {
    const app = await createApiApp(apiTestEnvironment);
    apps.push(app);
    const server = app.getHttpAdapter().getInstance();
    const guest = await add(server, undefined, 2, 0);
    const sessionCookie = await signIn(server);
    const attachKey = crypto.randomUUID();
    const correlationId = crypto.randomUUID();
    const request = {
      method: "POST" as const,
      url: "/v1/cart/attach",
      headers: {
        cookie: `${sessionCookie}; ${guest.headers["set-cookie"]!}`,
        "idempotency-key": attachKey,
        "x-correlation-id": correlationId,
      },
      payload: {},
    };
    const attached = await server.inject(request);
    const replayed = await server.inject(request);
    expect(attached.statusCode).toBe(200);
    expect(replayed.json()).toEqual(attached.json());

    const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
    const audits = await sql<Array<{ operation: string; correlationId: string }>>`
      select operation, correlation_id as "correlationId" from order_cart_audits
      where operation = 'ATTACH_IDENTITY'
    `;
    expect(audits).toEqual([{ operation: "ATTACH_IDENTITY", correlationId }]);

    await sql`
      update order_carts set status = 'EXPIRED', identity_id = null
      where id = ${attached.json().cart.cartId}
    `;
    await sql.end();
    const nextGuest = await add(server, undefined, 1, 0);
    const reusedForAnotherCart = await server.inject({
      ...request,
      headers: {
        ...request.headers,
        cookie: `${sessionCookie}; ${nextGuest.headers["set-cookie"]!}`,
      },
    });
    expect(reusedForAnotherCart.statusCode).toBe(409);
    expect(reusedForAnotherCart.json()).toMatchObject({
      code: "IDEMPOTENCY_CONFLICT",
    });
  });

  it("does not confirm review when an authoritative product disappeared", async () => {
    const app = await createApiApp(apiTestEnvironment);
    apps.push(app);
    const server = app.getHttpAdapter().getInstance();
    const first = await add(server, undefined, 1, 0);
    const cookie = first.headers["set-cookie"]!;
    const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
    await sql`delete from product_products where id = ${productId}`;
    await sql.end();

    const reviewed = await server.inject({
      method: "POST",
      url: "/v1/cart/review",
      headers: { cookie, "idempotency-key": crypto.randomUUID() },
      payload: { expectedRevision: 1, confirmed: true },
    });
    expect(reviewed.statusCode).toBe(409);
    expect(reviewed.json()).toMatchObject({ code: "VARIANT_UNAVAILABLE" });
    const revisions = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
    const rows = await revisions<Array<{ revision: number }>>`
      select revision from order_carts where id = ${first.json().cartId}
    `;
    await revisions.end();
    expect(rows[0]?.revision).toBe(1);
  });

  it("returns Retry-After while the same cart write is in progress", async () => {
    const app = await createApiApp(apiTestEnvironment);
    apps.push(app);
    const server = app.getHttpAdapter().getInstance();
    const first = await add(server, undefined, 1, 0);
    const cookie = first.headers["set-cookie"]!;
    const guestSecret = /sevo_cart=([^;]+)/.exec(cookie)?.[1];
    if (!guestSecret) throw new Error("Guest cart cookie was not returned");
    const scope = createHash("sha256").update(guestSecret).digest("hex");
    const key = crypto.randomUUID();
    const lockKey = `cart-idempotency:REMOVE_CART_ITEM:${scope}:${key}`;
    const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
    try {
      await sql.begin(async (transaction) => {
        await transaction`
          select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))
        `;
        const response = await server.inject({
          method: "DELETE",
          url: `/v1/cart/items/${variantId}`,
          headers: { cookie, "idempotency-key": key },
          payload: { expectedRevision: 1 },
        });
        expect(response.statusCode).toBe(409);
        expect(response.headers["retry-after"]).toBe("1");
        expect(response.json()).toMatchObject({ code: "IDEMPOTENCY_IN_PROGRESS" });
      });
    } finally {
      await sql.end();
    }
  });

  it("replays the original stale-write response after the cart changes again", async () => {
    const app = await createApiApp(apiTestEnvironment);
    apps.push(app);
    const server = app.getHttpAdapter().getInstance();
    const first = await add(server, undefined, 1, 0);
    const cookie = first.headers["set-cookie"]!;
    const key = crypto.randomUUID();
    const staleRequest = {
      method: "DELETE" as const,
      url: `/v1/cart/items/${variantId}`,
      headers: { cookie, "idempotency-key": key },
      payload: { expectedRevision: 0 },
    };
    const stale = await server.inject(staleRequest);
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({
      code: "CART_REVISION_CONFLICT",
      currentCart: { revision: 1 },
    });
    const changed = await server.inject({
      method: "PUT",
      url: `/v1/cart/items/${variantId}`,
      headers: { cookie, "idempotency-key": crypto.randomUUID() },
      payload: { variantId, quantity: 2, expectedRevision: 1 },
    });
    expect(changed.statusCode).toBe(200);
    const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
    await sql`update product_offers set amount = 9900000, revision = revision + 1`;
    await sql.end();
    const replayed = await server.inject(staleRequest);
    expect(replayed.statusCode).toBe(409);
    expect(replayed.json()).toEqual(stale.json());
  });

  it("keeps the current store until the guest explicitly confirms replacement", async () => {
    const app = await createApiApp(apiTestEnvironment);
    apps.push(app);
    const server = app.getHttpAdapter().getInstance();
    const first = await add(server, undefined, 1, 0);
    const cookie = first.headers["set-cookie"]!;
    const rejectedKey = crypto.randomUUID();
    const rejectedRequest = {
      method: "PUT",
      url: `/v1/cart/items/${other.variantId}`,
      headers: { cookie, "idempotency-key": rejectedKey },
      payload: {
        variantId: other.variantId,
        quantity: 1,
        expectedRevision: 1,
      },
    } as const;
    const rejected = await server.inject(rejectedRequest);
    expect(rejected.statusCode).toBe(409);
    expect(rejected.json()).toMatchObject({
      code: "STORE_REPLACEMENT_CONFIRMATION_REQUIRED",
      storeReplacement: {
        currentStoreName: "خانه فنجان",
        nextStoreName: "خانه پارچه",
        removedItemCount: 1,
      },
    });

    const replacementKey = crypto.randomUUID();
    const replacementRequest = {
      method: "POST" as const,
      url: "/v1/cart/store-replacement",
      headers: { cookie, "idempotency-key": replacementKey },
      payload: {
        variantId: other.variantId,
        quantity: 1,
        expectedRevision: 1,
        confirmed: true,
      },
    };
    const replaced = await server.inject({
      ...replacementRequest,
    });
    expect(replaced.statusCode).toBe(200);
    expect(cartContract.parse(replaced.json())).toMatchObject({
      store: { storeId: other.storeId, name: "خانه پارچه" },
      revision: 1,
      items: [{ variantId: other.variantId, quantity: 1 }],
    });
    const replayed = await server.inject(replacementRequest);
    expect(replayed.statusCode).toBe(200);
    expect(replayed.json()).toEqual(replaced.json());
    expect(replayed.headers["set-cookie"]).toBe(replaced.headers["set-cookie"]);
    const replayedRejection = await server.inject(rejectedRequest);
    expect(replayedRejection.statusCode).toBe(409);
    expect(replayedRejection.json()).toEqual(rejected.json());
  });

  it("rejects one of two concurrent mutations from the same revision", async () => {
    const app = await createApiApp(apiTestEnvironment);
    apps.push(app);
    const server = app.getHttpAdapter().getInstance();
    const first = await add(server, undefined, 1, 0);
    const cookie = first.headers["set-cookie"]!;
    const mutate = (quantity: number) =>
      server.inject({
        method: "PUT",
        url: `/v1/cart/items/${variantId}`,
        headers: { cookie, "idempotency-key": crypto.randomUUID() },
        payload: { variantId, quantity, expectedRevision: 1 },
      });

    const responses = await Promise.all([mutate(2), mutate(3)]);
    expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 409]);
    const conflict = responses.find((response) => response.statusCode === 409)!;
    expect(conflict.json()).toMatchObject({
      code: "CART_REVISION_CONFLICT",
      currentCart: { revision: 2, items: [{ quantity: expect.any(Number) }] },
    });
    const current = await server.inject({
      method: "GET",
      url: "/v1/cart",
      headers: { cookie },
    });
    expect(cartContract.parse(current.json().cart)).toMatchObject({
      revision: 2,
      items: [{ quantity: expect.any(Number) }],
    });
  });

  it("returns a fresh snapshot and retry action when another tab removes an item", async () => {
    const app = await createApiApp(apiTestEnvironment);
    apps.push(app);
    const server = app.getHttpAdapter().getInstance();
    const first = await add(server, undefined, 1, 0);
    const cookie = first.headers["set-cookie"]!;

    const removed = await server.inject({
      method: "DELETE",
      url: `/v1/cart/items/${variantId}`,
      headers: { cookie, "idempotency-key": crypto.randomUUID() },
      payload: { expectedRevision: 1 },
    });
    expect(removed.statusCode, JSON.stringify(removed.json())).toBe(200);

    const stale = await server.inject({
      method: "PUT",
      url: `/v1/cart/items/${variantId}`,
      headers: { cookie, "idempotency-key": crypto.randomUUID() },
      payload: { variantId, quantity: 3, expectedRevision: 1 },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({
      code: "CART_REVISION_CONFLICT",
      currentCart: { revision: 2, items: [] },
      resolution: { action: "REVIEW_AND_RETRY", expectedRevision: 2 },
    });
  });

  it("requires a fresh review after product price or store policy changes", async () => {
    const app = await createApiApp(apiTestEnvironment);
    apps.push(app);
    const server = app.getHttpAdapter().getInstance();
    const first = await add(server, undefined, 1, 0);
    const cookie = first.headers["set-cookie"]!;
    expect(first.json()).toMatchObject({ reviewRequired: false, reviewChanges: [] });

    const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
    await sql`update product_offers set amount = 4700000, revision = 2`;
    await sql`
      insert into product_publications
        (product_id, publication_version, name, description, media_id, variant_id)
      values
        (${productId}, 2, 'فنجان سرامیکی تازه', 'فنجان دست‌ساز', ${mediaId}, ${variantId})
    `;
    await sql`
      update product_products set publication_version = 2, revision = revision + 1
      where id = ${productId}
    `;
    await sql`
      update store_stores set return_policy = 'شرایط مرجوعی تازه فروشگاه',
        return_policy_revision = 2, revision = revision + 1
      where id = ${storeId}
    `;
    await sql.end();

    const changed = await server.inject({
      method: "GET",
      url: "/v1/cart",
      headers: { cookie },
    });
    expect(changed.statusCode).toBe(200);
    expect(cartContract.parse(changed.json().cart)).toMatchObject({
      revision: 1,
      reviewRequired: true,
      reviewChanges: expect.arrayContaining([
        expect.objectContaining({ kind: "PRICE_CHANGED", variantId }),
        { kind: "PRODUCT_CHANGED", variantId },
        expect.objectContaining({
          kind: "POLICY_CHANGED",
          currentPolicyText: "شرایط مرجوعی تازه فروشگاه",
        }),
      ]),
    });

    const reviewed = await server.inject({
      method: "POST",
      url: "/v1/cart/review",
      headers: { cookie, "idempotency-key": crypto.randomUUID() },
      payload: { expectedRevision: 1, confirmed: true },
    });
    expect(reviewed.statusCode, JSON.stringify(reviewed.json())).toBe(200);
    expect(cartContract.parse(reviewed.json())).toMatchObject({
      revision: 2,
      reviewRequired: false,
      reviewChanges: [],
    });
  });
});

type TestServer =
  Awaited<ReturnType<typeof createApiApp>> extends infer T
    ? T extends { getHttpAdapter(): { getInstance(): infer S } }
      ? S
      : never
    : never;

async function add(
  server: TestServer,
  cookie: string | undefined,
  quantity: number,
  expectedRevision: number,
) {
  return server.inject({
    method: "PUT",
    url: "/v1/cart/items/a3991ca0-50f6-44b9-a4b2-5ae917e5dac7",
    headers: {
      ...(cookie ? { cookie } : { "x-sevo-guest-scope": crypto.randomUUID() }),
      "idempotency-key": crypto.randomUUID(),
    },
    payload: {
      variantId: "a3991ca0-50f6-44b9-a4b2-5ae917e5dac7",
      quantity,
      expectedRevision,
    },
  });
}

async function signIn(server: TestServer) {
  const requested = await server.inject({
    method: "POST",
    url: "/v1/auth/otp/requests",
    payload: { mobile: "09123456789" },
  });
  const verified = await server.inject({
    method: "POST",
    url: "/v1/auth/otp/verifications",
    payload: {
      challengeId: requested.json<{ challengeId: string }>().challengeId,
      code: "111111",
    },
  });
  return verified.headers["set-cookie"]!;
}
