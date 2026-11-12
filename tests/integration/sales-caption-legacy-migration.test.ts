import { readFile } from "node:fs/promises";
import postgres from "postgres";
import { expect, it } from "vitest";
import { apiTestEnvironment } from "../helpers/api-test-environment";

it("preserves pre-caption seller and public rows through the actual caption migration", async () => {
  const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
  const schema = `caption_legacy_${crypto.randomUUID().replaceAll("-", "")}`;
  const migration = async (name: string) =>
    readFile(`packages/database/prisma/migrations/${name}/migration.sql`, "utf8");
  try {
    await sql.unsafe(`create schema "${schema}"`);
    await sql.unsafe(`set search_path to "${schema}"`);
    await sql.unsafe(
      await migration("20260829130000__content__sales-and-purchase-content"),
    );
    await sql.unsafe(
      await migration("20260901133000__content__public-sales-content-projection"),
    );
    const id = crypto.randomUUID(),
      store = crypto.randomUUID(),
      actor = crypto.randomUUID(),
      media = crypto.randomUUID();
    await sql`insert into content_sales_contents (id, store_id, actor_identity_id, media_id, media_kind) values (${id}, ${store}, ${actor}, ${media}, 'IMAGE')`;
    await sql`insert into content_public_sales_contents (content_id, store_id, source, moderation_state, media_id, media_kind, aggregate_version, published_at, updated_at) values (${id}, ${store}, 'SELLER', 'PUBLISHED', ${media}, 'IMAGE', 1, now(), now())`;
    await sql.unsafe(await migration("20260927110000__content__sales-caption"));
    const seller = await sql`select id, media_id, caption from content_sales_contents`;
    const publicRows =
      await sql`select content_id, media_id, caption from content_public_sales_contents`;
    expect(seller).toMatchObject([{ id, media_id: media, caption: null }]);
    expect(publicRows).toMatchObject([
      { content_id: id, media_id: media, caption: null },
    ]);
    await sql`update content_sales_contents set caption = 'متن فارسی پس از مهاجرت' where id = ${id}`;
    expect((await sql`select caption from content_sales_contents`)[0]?.caption).toBe(
      "متن فارسی پس از مهاجرت",
    );
  } finally {
    await sql.unsafe("set search_path to public");
    await sql.unsafe(`drop schema if exists "${schema}" cascade`);
    await sql.end();
  }
});
