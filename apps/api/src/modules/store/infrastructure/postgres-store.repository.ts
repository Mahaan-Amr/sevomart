import { randomUUID } from "node:crypto";

import {
  storePolicyChangedV1Contract,
  storePublishedV1Contract,
  storeUnpublishedV1Contract,
} from "@sevo/contracts/store/v1";
import { storeIdContract, type IdentityId } from "@sevo/contracts/platform/v1";
import { enqueueOutboxEvent } from "@sevo/outbox";
import postgres, { type JSONValue, type Sql } from "postgres";

import {
  type ApprovedSellerStoreProvisioner,
  type OpaqueStoreTransactionContext,
  StoreIdempotencyConflictError,
  StoreRevisionConflictError,
  type StoreRepository,
  type StoreRow,
  type StoreShippingMethod,
  type StoreWriteContext,
} from "../public";

type StoreDatabaseShippingMethod = Omit<StoreShippingMethod, "fixedFeeAmount"> & {
  fixedFeeAmount: number | string;
};

type StoreDatabaseRow = Omit<StoreRow, "shippingMethods" | "settlementDestination"> & {
  settlementKind?: "TEST";
  settlementStatus?: "TEST_VERIFIED";
  settlementVerifiedAt?: Date;
  shippingMethods: StoreDatabaseShippingMethod[];
};

type StoredIdempotencyRow = {
  requestHash: string;
  responseJson: JSONValue;
};

export class PostgresStoreRepository
  implements StoreRepository, ApprovedSellerStoreProvisioner
{
  readonly #sql: Sql;
  readonly #createEventId: () => string;

  constructor(databaseUrl: string, createEventId: () => string = randomUUID) {
    this.#sql = postgres(databaseUrl, { max: 5 });
    this.#createEventId = createEventId;
  }

  async findById(id: string) {
    return this.#find({ id });
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

  async provisionApprovedSellerStore(command: {
    identityId: IdentityId;
    proposedStoreName: string;
    idempotencyKey: string;
    correlationId: string;
    transactionContext: OpaqueStoreTransactionContext;
  }) {
    const sql = command.transactionContext.transaction as Sql;
    if (command.transactionContext.kind !== "opaque-store-transaction") {
      throw new Error("Approved seller store transaction context is invalid");
    }
    await sql`
      select pg_advisory_xact_lock(
        hashtextextended(${`approved-seller-store:${command.identityId}`}, 0)
      )
    `;
    const existing = await sql<Array<{ storeId: string; revision: number }>>`
      select s.id as "storeId", s.revision
      from store_stores s
      join store_memberships m on m.store_id = s.id and m.role = 'OWNER'
      where m.seller_id = ${command.identityId}
      limit 1
    `;
    if (existing[0]) {
      return {
        storeId: storeIdContract.parse(existing[0].storeId),
        revision: existing[0].revision,
      };
    }

    const storeId = randomUUID();
    const occurredAt = new Date();
    await sql`
      insert into store_stores
        (id, name, status, publication_version, revision,
         return_policy_revision, updated_at)
      values
        (${storeId}, ${command.proposedStoreName}, 'DRAFT', 0, 1, 0, ${occurredAt})
    `;
    await sql`
      insert into store_memberships (id, store_id, seller_id, role)
      values (${randomUUID()}, ${storeId}, ${command.identityId}, 'OWNER')
    `;
    return { storeId: storeIdContract.parse(storeId), revision: 1 };
  }

  async #find(criteria: { id?: string; sellerId?: string; slug?: string }) {
    return this.#findWithSql(this.#sql, criteria);
  }

  async #findWithSql(
    sql: Sql,
    criteria: { id?: string; sellerId?: string; slug?: string },
  ) {
    const id = criteria.id ?? null;
    const sellerId = criteria.sellerId ?? null;
    const slug = criteria.slug ?? null;
    const rows = await sql<StoreDatabaseRow[]>`
      select s.id, s.name, s.slug, s.bio,
        s.return_policy as "returnPolicy",
        s.return_policy_revision as "returnPolicyRevision",
        s.settlement_kind as "settlementKind",
        s.settlement_status as "settlementStatus",
        s.settlement_verified_at as "settlementVerifiedAt",
        s.logo_media_id as "logoMediaId", s.cover_media_id as "coverMediaId",
        s.theme_color as "themeColor", s.status, s.published_at as "publishedAt",
        s.publication_version as "publicationVersion", s.revision,
        s.updated_at as "updatedAt", m.seller_id as "sellerId",
        coalesce(json_agg(json_build_object(
          'id', sm.id,
          'revision', sm.revision,
          'code', sm.code,
          'label', sm.label,
          'fixedFeeAmount', sm.fixed_fee_amount,
          'currency', sm.currency,
          'estimatedDeliveryText', sm.estimated_delivery_text,
          'enabled', sm.enabled,
          'requiresDeliveryAddress', sm.requires_delivery_address,
          'requiresPostalCode', sm.requires_postal_code
        ) order by sm.position) filter (where sm.id is not null), '[]') as "shippingMethods"
      from store_stores s
      join store_memberships m on m.store_id = s.id and m.role = 'OWNER'
      left join store_shipping_methods sm on sm.store_id = s.id
      where (${id}::uuid is not null and s.id = ${id}::uuid)
         or (${sellerId}::uuid is not null and m.seller_id = ${sellerId}::uuid)
         or (${slug}::text is not null and s.slug = ${slug})
      group by s.id, m.seller_id
      limit 1
    `;
    const row = rows[0];
    return row ? fromDatabase(row) : undefined;
  }

  async saveDraft(row: StoreRow, context: StoreWriteContext): Promise<StoreRow> {
    return this.#sql.begin((sql) =>
      this.#idempotentWrite(sql, context, async () => {
        await sql`select pg_advisory_xact_lock(hashtextextended(${row.sellerId}, 0))`;
        const currentRows = await sql<
          Array<{ revision: number; status: string; publicationVersion: number }>
        >`
          select s.revision, s.status,
            s.publication_version as "publicationVersion"
          from store_stores s
          left join store_memberships m on m.store_id = s.id and m.role = 'OWNER'
          where s.id = ${row.id}::uuid or m.seller_id = ${row.sellerId}::uuid
          for update of s
        `;
        const current = currentRows[0];
        const currentRevision = current?.revision ?? 0;
        if (currentRevision !== context.expectedRevision) {
          throw new StoreRevisionConflictError(
            context.expectedRevision,
            currentRevision,
          );
        }
        const revision = currentRevision + 1;
        await sql`
          insert into store_stores
            (id, name, slug, bio, return_policy, return_policy_revision,
             settlement_kind, settlement_status, settlement_verified_at,
             logo_media_id, cover_media_id, theme_color, status, published_at,
             publication_version, revision, updated_at)
          values
            (${row.id}, ${row.name ?? null}, ${row.slug ?? null},
             ${row.bio ?? null}, ${row.returnPolicy ?? null},
             ${row.returnPolicyRevision ?? 0},
             ${row.settlementDestination?.kind ?? null},
             ${row.settlementDestination?.status ?? null},
             ${row.settlementDestination?.verifiedAt ?? null},
             ${row.logoMediaId ?? null}, ${row.coverMediaId ?? null},
             ${row.themeColor ?? null}, 'DRAFT', null,
             ${current?.publicationVersion ?? row.publicationVersion ?? 0},
             ${revision}, ${row.updatedAt})
          on conflict (id) do update set
            name = excluded.name, slug = excluded.slug, bio = excluded.bio,
            return_policy = excluded.return_policy,
            return_policy_revision = excluded.return_policy_revision,
            settlement_kind = excluded.settlement_kind,
            settlement_status = excluded.settlement_status,
            settlement_verified_at = excluded.settlement_verified_at,
            logo_media_id = excluded.logo_media_id,
            cover_media_id = excluded.cover_media_id,
            theme_color = excluded.theme_color, status = 'DRAFT',
            published_at = null, revision = excluded.revision,
            updated_at = excluded.updated_at
        `;
        await sql`
          insert into store_memberships (id, store_id, seller_id, role)
          values (${randomUUID()}, ${row.id}, ${row.sellerId}, 'OWNER')
          on conflict (store_id, seller_id) do nothing
        `;

        const shippingMethodIds = row.shippingMethods?.map((method) => method.id) ?? [];
        if (shippingMethodIds.length > 0) {
          await sql`
            delete from store_shipping_methods
            where store_id = ${row.id} and id not in ${sql(shippingMethodIds)}
          `;
        } else {
          await sql`delete from store_shipping_methods where store_id = ${row.id}`;
        }
        for (const [position, method] of (row.shippingMethods ?? []).entries()) {
          await sql`
            insert into store_shipping_methods
              (id, store_id, position, revision, code, label, fixed_fee_amount,
               currency, estimated_delivery_text, enabled,
               requires_delivery_address, requires_postal_code)
            values
              (${method.id}, ${row.id}, ${position}, ${method.revision},
               ${method.code}, ${method.label}, ${method.fixedFeeAmount},
               ${method.currency}, ${method.estimatedDeliveryText}, ${method.enabled},
               ${method.requiresDeliveryAddress}, ${method.requiresPostalCode})
            on conflict (id) do update set
              position = excluded.position, revision = excluded.revision,
              code = excluded.code, label = excluded.label,
              fixed_fee_amount = excluded.fixed_fee_amount,
              currency = excluded.currency,
              estimated_delivery_text = excluded.estimated_delivery_text,
              enabled = excluded.enabled,
              requires_delivery_address = excluded.requires_delivery_address,
              requires_postal_code = excluded.requires_postal_code
          `;
        }

        const eventBase = {
          version: 1 as const,
          aggregateId: row.id,
          aggregateVersion: revision,
          occurredAt: row.updatedAt.toISOString(),
          correlationId: context.correlationId,
          actor: { type: "IDENTITY" as const, id: context.actorId },
        };
        if (current?.status === "PUBLISHED") {
          await enqueueOutboxEvent(
            sql,
            storeUnpublishedV1Contract.parse({
              ...eventBase,
              eventId: this.#createEventId(),
              eventType: "StoreUnpublished.v1",
              payload: {
                storeId: row.id,
                publicationStatus: "DRAFT",
                publicationVersion: current.publicationVersion,
              },
            }),
          );
        }
        if (context.policyChanged) {
          await enqueueOutboxEvent(
            sql,
            storePolicyChangedV1Contract.parse({
              ...eventBase,
              eventId: this.#createEventId(),
              eventType: "StorePolicyChanged.v1",
              payload: {
                storeId: row.id,
                returnPolicyRevision: row.returnPolicyRevision ?? 0,
                shippingMethods: (row.shippingMethods ?? []).map((method) => ({
                  id: method.id,
                  revision: method.revision,
                })),
              },
            }),
          );
        }
        return (await this.#findWithSql(sql, { id: row.id }))!;
      }),
    );
  }

  async publish(
    id: string,
    publishedAt: Date,
    context: StoreWriteContext,
  ): Promise<StoreRow> {
    return this.#sql.begin((sql) =>
      this.#idempotentWrite(sql, context, async () => {
        const currentRows = await sql<
          Array<{ revision: number; status: string; publicationVersion: number }>
        >`
          select revision, status, publication_version as "publicationVersion"
          from store_stores where id = ${id}::uuid for update
        `;
        const current = currentRows[0];
        if (!current) throw new Error("Store publication transition failed");
        if (current.revision !== context.expectedRevision) {
          throw new StoreRevisionConflictError(
            context.expectedRevision,
            current.revision,
          );
        }
        if (current.status === "PUBLISHED") {
          return (await this.#findWithSql(sql, { id }))!;
        }
        const revision = current.revision + 1;
        const publicationVersion = current.publicationVersion + 1;
        await sql`
          update store_stores set status = 'PUBLISHED', published_at = ${publishedAt},
            updated_at = ${publishedAt}, publication_version = ${publicationVersion},
            revision = ${revision}
          where id = ${id}
        `;
        await enqueueOutboxEvent(
          sql,
          storePublishedV1Contract.parse({
            version: 1,
            eventId: this.#createEventId(),
            eventType: "StorePublished.v1",
            aggregateId: id,
            aggregateVersion: revision,
            occurredAt: publishedAt.toISOString(),
            correlationId: context.correlationId,
            actor: { type: "IDENTITY", id: context.actorId },
            payload: {
              storeId: id,
              publicationStatus: "PUBLISHED",
              publicationVersion,
            },
          }),
        );
        return (await this.#findWithSql(sql, { id }))!;
      }),
    );
  }

  async #idempotentWrite(
    sql: Sql,
    context: StoreWriteContext,
    write: () => Promise<StoreRow>,
  ): Promise<StoreRow> {
    const claimed = await sql<Array<{ operation: string }>>`
      insert into store_idempotency_records
        (operation, actor_identity_id, idempotency_key, request_hash, response_json)
      values
        (${context.operation}, ${context.actorId}, ${context.idempotencyKey},
         ${context.requestHash}, ${sql.json({})})
      on conflict (operation, actor_identity_id, idempotency_key) do nothing
      returning operation
    `;
    if (!claimed[0]) {
      const records = await sql<StoredIdempotencyRow[]>`
        select request_hash as "requestHash", response_json as "responseJson"
        from store_idempotency_records
        where operation = ${context.operation}
          and actor_identity_id = ${context.actorId}
          and idempotency_key = ${context.idempotencyKey}
        for update
      `;
      const record = records[0];
      if (!record || record.requestHash !== context.requestHash) {
        throw new StoreIdempotencyConflictError(context.idempotencyKey);
      }
      return deserializeRow(record.responseJson);
    }

    const result = await write();
    await sql`
      update store_idempotency_records
      set response_json = ${sql.json(serializeRow(result))}
      where operation = ${context.operation}
        and actor_identity_id = ${context.actorId}
        and idempotency_key = ${context.idempotencyKey}
    `;
    return result;
  }

  async onModuleDestroy() {
    await this.#sql.end();
  }
}

function fromDatabase(row: StoreDatabaseRow): StoreRow {
  return {
    ...row,
    shippingMethods: row.shippingMethods.map((method) => ({
      ...method,
      fixedFeeAmount: Number(method.fixedFeeAmount),
    })),
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

function serializeRow(row: StoreRow): JSONValue {
  return JSON.parse(JSON.stringify(row)) as JSONValue;
}

function deserializeRow(value: JSONValue): StoreRow {
  const row = value as unknown as Record<string, unknown>;
  return {
    ...(row as unknown as StoreRow),
    updatedAt: new Date(String(row.updatedAt)),
    ...(row.publishedAt ? { publishedAt: new Date(String(row.publishedAt)) } : {}),
    settlementDestination: row.settlementDestination
      ? {
          kind: "TEST",
          status: "TEST_VERIFIED",
          verifiedAt: new Date(
            String(
              (row.settlementDestination as unknown as { verifiedAt: string })
                .verifiedAt,
            ),
          ),
        }
      : undefined,
  };
}
