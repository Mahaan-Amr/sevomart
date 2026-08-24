import { savedAddressContract } from "@sevo/contracts/orders/v1";
import postgres from "postgres";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApiApp } from "../../apps/api/src/create-app";
import { apiTestEnvironment } from "../helpers/api-test-environment";

const addressTestEnvironment = {
  ...apiTestEnvironment,
  DEV_OTP_TEST_MOBILES: [
    "09120000001",
    "09120000002",
    "09120000003",
    "09120000004",
    "09120000005",
  ] as typeof apiTestEnvironment.DEV_OTP_TEST_MOBILES,
};

const validAddress = {
  recipientName: "سارا احمدی",
  recipientMobile: "۰۹۱۲۳۴۵۶۷۸۹",
  provinceText: "تهران",
  cityText: "تهران",
  addressLine: "خیابان آزادی، کوچه بهار، پلاک ۱۲",
  postalCode: "۱۲۳۴۵۶۷۸۹۰",
};

describe("versioned saved address HTTP API", () => {
  const apps: Awaited<ReturnType<typeof createApiApp>>[] = [];

  beforeEach(async () => {
    const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
    await sql`delete from order_saved_address_idempotency_records`;
    await sql`delete from order_saved_address_audits`;
    await sql`delete from order_saved_address_revisions`;
    await sql`delete from order_saved_addresses`;
    await sql`delete from identity_otp_challenges where mobile like '0912000000%'`;
    await sql.end();
  });

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it("creates idempotently, versions edits, and rejects a stale revision", async () => {
    const app = await createApiApp(addressTestEnvironment);
    apps.push(app);
    const server = app.getHttpAdapter().getInstance();
    const session = await signIn(server, "09120000001");
    const createKey = crypto.randomUUID();
    const createRequest = {
      method: "POST" as const,
      url: "/v1/addresses",
      headers: { cookie: session, "idempotency-key": createKey },
      payload: validAddress,
    };
    const created = await server.inject(createRequest);
    expect(created.statusCode, JSON.stringify(created.json())).toBe(201);
    const address = savedAddressContract.parse(created.json());
    expect(address).toMatchObject({
      revision: 1,
      recipientMobile: "09123456789",
      postalCode: "1234567890",
    });
    expect((await server.inject(createRequest)).json()).toEqual(created.json());

    const updateKey = crypto.randomUUID();
    const updated = await server.inject({
      method: "PUT",
      url: `/v1/addresses/${address.addressId}`,
      headers: { cookie: session, "idempotency-key": updateKey },
      payload: {
        ...validAddress,
        addressLine: "خیابان آزادی، پلاک ۱۴",
        expectedRevision: 1,
      },
    });
    expect(updated.statusCode, JSON.stringify(updated.json())).toBe(200);
    expect(savedAddressContract.parse(updated.json())).toMatchObject({
      revision: 2,
      addressLine: "خیابان آزادی، پلاک ۱۴",
    });

    const stale = await server.inject({
      method: "PUT",
      url: `/v1/addresses/${address.addressId}`,
      headers: { cookie: session, "idempotency-key": crypto.randomUUID() },
      payload: { ...validAddress, expectedRevision: 1 },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({
      code: "ADDRESS_REVISION_CONFLICT",
      currentAddress: { revision: 2, addressLine: "خیابان آزادی، پلاک ۱۴" },
    });
  });

  it("does not reveal or mutate another identity's address", async () => {
    const app = await createApiApp(addressTestEnvironment);
    apps.push(app);
    const server = app.getHttpAdapter().getInstance();
    const owner = await signIn(server, "09120000002");
    const other = await signIn(server, "09120000003");
    const created = await server.inject({
      method: "POST",
      url: "/v1/addresses",
      headers: { cookie: owner, "idempotency-key": crypto.randomUUID() },
      payload: validAddress,
    });
    const address = savedAddressContract.parse(created.json());

    const list = await server.inject({
      method: "GET",
      url: "/v1/addresses",
      headers: { cookie: other },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toEqual({ addresses: [] });
    const forbiddenUpdate = await server.inject({
      method: "PUT",
      url: `/v1/addresses/${address.addressId}`,
      headers: { cookie: other, "idempotency-key": crypto.randomUUID() },
      payload: { ...validAddress, expectedRevision: 1 },
    });
    expect(forbiddenUpdate.statusCode).toBe(404);
    expect(forbiddenUpdate.json()).toMatchObject({ code: "ADDRESS_NOT_FOUND" });
  });

  it("soft-deletes the current address while preserving history and PII-free audit", async () => {
    const app = await createApiApp(addressTestEnvironment);
    apps.push(app);
    const server = app.getHttpAdapter().getInstance();
    const session = await signIn(server, "09120000004");
    const created = await server.inject({
      method: "POST",
      url: "/v1/addresses",
      headers: { cookie: session, "idempotency-key": crypto.randomUUID() },
      payload: validAddress,
    });
    const address = savedAddressContract.parse(created.json());
    const deleted = await server.inject({
      method: "DELETE",
      url: `/v1/addresses/${address.addressId}`,
      headers: { cookie: session, "idempotency-key": crypto.randomUUID() },
      payload: { expectedRevision: 1 },
    });
    expect(deleted.statusCode).toBe(204);

    const list = await server.inject({
      method: "GET",
      url: "/v1/addresses",
      headers: { cookie: session },
    });
    expect(list.json()).toEqual({ addresses: [] });
    const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
    const rows = await sql<Array<{ status: string; revisions: number }>>`
      select a.status, count(r.revision)::int as revisions
      from order_saved_addresses a
      join order_saved_address_revisions r on r.address_id = a.id
      where a.id = ${address.addressId}
      group by a.status
    `;
    const audits = await sql<Array<Record<string, unknown>>>`
      select operation, revision, correlation_id from order_saved_address_audits
      where address_id = ${address.addressId} order by created_at
    `;
    await sql.end();
    expect(rows[0]).toEqual({ status: "DELETED", revisions: 1 });
    expect(audits.map((audit) => audit.operation)).toEqual(["CREATE", "DELETE"]);
    expect(JSON.stringify(audits)).not.toMatch(/سارا|09123456789|خیابان/);
  });

  it("returns a human validation error for an invalid Iranian mobile", async () => {
    const app = await createApiApp(addressTestEnvironment);
    apps.push(app);
    const server = app.getHttpAdapter().getInstance();
    const session = await signIn(server, "09120000005");
    const response = await server.inject({
      method: "POST",
      url: "/v1/addresses",
      headers: { cookie: session, "idempotency-key": crypto.randomUUID() },
      payload: { ...validAddress, recipientMobile: "02112345678" },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      code: "ADDRESS_INVALID",
      message: "شماره موبایل گیرنده باید با ۰۹ شروع شود و ۱۱ رقم باشد.",
    });
  });
});

type TestServer =
  Awaited<ReturnType<typeof createApiApp>> extends infer T
    ? T extends { getHttpAdapter(): { getInstance(): infer S } }
      ? S
      : never
    : never;

async function signIn(server: TestServer, mobile: string) {
  const requested = await server.inject({
    method: "POST",
    url: "/v1/auth/otp/requests",
    payload: { mobile },
  });
  if (requested.statusCode !== 202) {
    throw new Error(`OTP request failed: ${requested.statusCode} ${requested.body}`);
  }
  const verified = await server.inject({
    method: "POST",
    url: "/v1/auth/otp/verifications",
    payload: {
      challengeId: requested.json<{ challengeId: string }>().challengeId,
      code: "111111",
    },
  });
  if (verified.statusCode !== 200) {
    throw new Error(`OTP verification failed: ${verified.statusCode} ${verified.body}`);
  }
  return verified.headers["set-cookie"]!;
}
