import { cartContract, cartResolutionContract } from "@sevo/contracts/orders/v1";
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
    await sql`delete from order_cart_idempotency_records`;
    await sql`delete from order_carts`;
    await sql`delete from inventory_levels`;
    await sql`delete from product_products`;
    await sql`delete from store_stores`;
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
    const added = await server.inject({
      method: "PUT",
      url: `/v1/cart/items/${variantId}`,
      headers: { "idempotency-key": key },
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
      headers: { cookie, "idempotency-key": key },
      payload: { variantId, quantity: 2, expectedRevision: 0 },
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json().revision).toBe(1);

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

  it("keeps the current store until the guest explicitly confirms replacement", async () => {
    const app = await createApiApp(apiTestEnvironment);
    apps.push(app);
    const server = app.getHttpAdapter().getInstance();
    const first = await add(server, undefined, 1, 0);
    const cookie = first.headers["set-cookie"]!;
    const rejected = await server.inject({
      method: "PUT",
      url: `/v1/cart/items/${other.variantId}`,
      headers: { cookie, "idempotency-key": crypto.randomUUID() },
      payload: {
        variantId: other.variantId,
        quantity: 1,
        expectedRevision: 1,
      },
    });
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
    headers: { ...(cookie ? { cookie } : {}), "idempotency-key": crypto.randomUUID() },
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
