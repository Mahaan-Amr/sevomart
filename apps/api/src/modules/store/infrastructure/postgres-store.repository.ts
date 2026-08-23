import postgres, { type Sql } from "postgres";
import { randomUUID } from "node:crypto";
import { storePublishedV1Contract } from "@sevo/contracts/store/v1";
import { enqueueOutboxEvent } from "@sevo/outbox";

import type { StoreRepository, StoreRow, StoreShippingMethod } from "../public";

type StoreDatabaseRow = Omit<StoreRow, "shippingMethods" | "settlementDestination"> & {
  settlementKind?: "TEST";
  settlementStatus?: "TEST_VERIFIED";
  settlementVerifiedAt?: Date;
  shippingMethods: StoreShippingMethod[];
};

export class PostgresStoreRepository implements StoreRepository {
  readonly #sql: Sql;
  readonly #createEventId: () => string;

  constructor(databaseUrl: string, createEventId: () => string = randomUUID) {
    this.#sql = postgres(databaseUrl, { max: 5 });
    this.#createEventId = createEventId;
  }

  async findBySellerId(sellerId: string) {
    return this.#find({ sellerId });
  }

  async findBySlug(slug: string) {
    return this.#find({ slug });
  }

  async isMediaPublished(mediaId: string): Promise<boolean> {
    const rows = await this.#sql<Array<{ published: boolean }>>`
      select exists (
        select 1 from store_stores
        where status = 'PUBLISHED'
          and (logo_media_id = ${mediaId}::uuid or cover_media_id = ${mediaId}::uuid)
      ) as published
    `;
    return rows[0]?.published ?? false;
  }

  async #find(criteria: { sellerId?: string; slug?: string }) {
    const sellerId = criteria.sellerId ?? null;
    const slug = criteria.slug ?? null;
    const rows = await this.#sql<StoreDatabaseRow[]>`
      select s.id, s.name, s.slug, s.bio,
        s.return_policy as "returnPolicy", s.settlement_kind as "settlementKind",
        s.settlement_status as "settlementStatus",
        s.settlement_verified_at as "settlementVerifiedAt",
        s.logo_media_id as "logoMediaId", s.cover_media_id as "coverMediaId",
        s.theme_color as "themeColor", s.status, s.published_at as "publishedAt",
        s.publication_version as "publicationVersion",
        s.updated_at as "updatedAt", m.seller_id as "sellerId",
        coalesce(json_agg(json_build_object('code', sm.code, 'label', sm.label)
          order by sm.position) filter (where sm.id is not null), '[]') as "shippingMethods"
      from store_stores s
      join store_memberships m on m.store_id = s.id and m.role = 'OWNER'
      left join store_shipping_methods sm on sm.store_id = s.id
      where (${sellerId}::uuid is not null and m.seller_id = ${sellerId}::uuid)
         or (${slug}::text is not null and s.slug = ${slug})
      group by s.id, m.seller_id
      limit 1
    `;
    const row = rows[0];
    return row ? fromDatabase(row) : undefined;
  }

  async saveDraft(row: StoreRow): Promise<StoreRow> {
    await this.#sql.begin(async (sql) => {
      await sql`
        insert into store_stores
          (id, name, slug, bio, return_policy, settlement_kind,
           settlement_status, settlement_verified_at, logo_media_id, cover_media_id,
           theme_color, status, published_at, updated_at)
        values
          (${row.id}, ${row.name ?? null}, ${row.slug ?? null},
           ${row.bio ?? null}, ${row.returnPolicy ?? null},
           ${row.settlementDestination?.kind ?? null},
           ${row.settlementDestination?.status ?? null},
           ${row.settlementDestination?.verifiedAt ?? null}, ${row.logoMediaId ?? null},
           ${row.coverMediaId ?? null}, ${row.themeColor ?? null}, ${row.status},
           ${row.publishedAt ?? null}, ${row.updatedAt})
        on conflict (id) do update set
          name = excluded.name, slug = excluded.slug, bio = excluded.bio,
          return_policy = excluded.return_policy,
          settlement_kind = excluded.settlement_kind,
          settlement_status = excluded.settlement_status,
          settlement_verified_at = excluded.settlement_verified_at,
          logo_media_id = excluded.logo_media_id, cover_media_id = excluded.cover_media_id,
          theme_color = excluded.theme_color, status = excluded.status,
          published_at = excluded.published_at, updated_at = excluded.updated_at
      `;
      await sql`
        insert into store_memberships (id, store_id, seller_id, role)
        values (${crypto.randomUUID()}, ${row.id}, ${row.sellerId}, 'OWNER')
        on conflict (store_id, seller_id) do nothing
      `;
      await sql`delete from store_shipping_methods where store_id = ${row.id}`;
      if (row.shippingMethods?.length) {
        await sql`
          insert into store_shipping_methods ${sql(
            row.shippingMethods.map((method, position) => ({
              id: crypto.randomUUID(),
              store_id: row.id,
              position,
              code: method.code,
              label: method.label,
            })),
          )}
        `;
      }
    });
    return (await this.findBySellerId(row.sellerId))!;
  }

  async publish(
    id: string,
    publishedAt: Date,
    context: { correlationId: string; actorId: string },
  ): Promise<StoreRow> {
    const rows = await this.#sql.begin(async (sql) => {
      const published = await sql<Array<{ id: string; publicationVersion: number }>>`
        update store_stores set status = 'PUBLISHED', published_at = ${publishedAt},
          updated_at = ${publishedAt}, publication_version = publication_version + 1
        where id = ${id}
        returning id, publication_version as "publicationVersion"
      `;
      const publication = published[0]!;
      const event = storePublishedV1Contract.parse({
        version: 1,
        eventId: this.#createEventId(),
        eventType: "StorePublished.v1",
        aggregateId: publication.id,
        aggregateVersion: publication.publicationVersion,
        occurredAt: publishedAt.toISOString(),
        correlationId: context.correlationId,
        actor: { type: "IDENTITY", id: context.actorId },
        payload: { storeId: publication.id, publicationStatus: "PUBLISHED" },
      });
      await enqueueOutboxEvent(sql, event);
      return [{ sellerId: context.actorId }];
    });
    return (await this.findBySellerId(rows[0]!.sellerId))!;
  }

  async onModuleDestroy() {
    await this.#sql.end();
  }
}

function fromDatabase(row: StoreDatabaseRow): StoreRow {
  return {
    ...row,
    settlementDestination:
      row.settlementKind && row.settlementStatus && row.settlementVerifiedAt
        ? {
            kind: row.settlementKind,
            status: row.settlementStatus,
            verifiedAt: row.settlementVerifiedAt,
          }
        : undefined,
  };
}
