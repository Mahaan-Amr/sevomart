import { randomUUID } from "node:crypto";

import type { Page } from "@playwright/test";
import postgres from "postgres";

export async function createSellerWorkspaceFixture(
  page: Page,
  input: { mobile: string; slug: string; storeName: string },
) {
  const databaseUrl =
    process.env.DATABASE_URL ?? "postgresql://sevo:sevo_local@localhost:6432/sevo";
  const sql = postgres(databaseUrl, { max: 1 });
  const storeId = randomUUID();

  await page.goto("/seller/login");
  await page.getByLabel("شماره موبایل").fill(input.mobile);
  await page.getByRole("button", { name: "دریافت کد" }).click();
  await page.getByLabel("کد شش‌رقمی").fill("111111");
  await page.getByRole("button", { name: "ورود" }).click();

  const identities = await sql<Array<{ identityId: string }>>`
    select identity_id as "identityId"
    from identity_login_methods
    where mobile = ${input.mobile}
  `;
  const identityId = identities[0]?.identityId;
  if (!identityId) throw new Error("seller identity was not created");

  await sql.begin(async (transaction) => {
    await transaction`
      insert into identity_seller_access (id, identity_id, status)
      values (${randomUUID()}, ${identityId}, 'ACTIVE')
      on conflict (identity_id) do update set status = 'ACTIVE'
    `;
    await transaction`
      insert into store_stores
        (id, name, slug, bio, return_policy, return_policy_revision,
         settlement_kind, settlement_status, settlement_verified_at,
         theme_color, status, published_at, publication_version, revision)
      values
        (${storeId}, ${input.storeName}, ${input.slug}, 'فروشگاه آزمون',
         'بازگشت کالا پس از هماهنگی بررسی می‌شود.', 1, 'TEST', 'TEST_VERIFIED',
         now(), '#A41439', 'PUBLISHED', now(), 1, 1)
    `;
    await transaction`
      insert into store_memberships (id, store_id, seller_id, role)
      values (${randomUUID()}, ${storeId}, ${identityId}, 'OWNER')
    `;
  });

  return {
    identityId,
    async cleanup() {
      await sql`delete from store_memberships where store_id = ${storeId}`;
      await sql`delete from store_stores where id = ${storeId}`;
      await sql`delete from identity_seller_access where identity_id = ${identityId}`;
      await sql.end();
    },
  };
}
