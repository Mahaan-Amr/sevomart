import { randomUUID } from "node:crypto";

import {
  productPurchaseExperiencesContract,
  publicSalesContentFeedV2Contract,
  sellerSalesContentItemV2Contract,
  sellerSalesContentListV2Contract,
} from "@sevo/contracts/content/v2";
import {
  purchaseExperienceContract,
  purchaseExperiencePublishedV1Contract,
  salesContentContract,
  salesContentPublishedV1Contract,
} from "@sevo/contracts/content/v1";
import { enqueueOutboxEvent } from "@sevo/outbox";
import postgres, { type JSONValue, type Sql } from "postgres";

import { ContentFault, type ContentMutation, type ContentRepository } from "../public";

type IdempotencyRecord = { requestHash: string; response: JSONValue };

export class PostgresContentRepository implements ContentRepository {
  readonly #sql: Sql;

  constructor(databaseUrl: string) {
    this.#sql = postgres(databaseUrl, { max: 5 });
  }

  async onModuleDestroy() {
    await this.#sql.end();
  }

  async isMediaPublished(mediaId: string) {
    const [row] = await this.#sql<Array<{ published: boolean }>>`
      select exists (
        select 1
        from content_sales_contents
        where media_id = ${mediaId}::uuid
          and moderation_state = 'PUBLISHED'
          and active
        union all
        select 1
        from content_purchase_experiences
        where ${mediaId}::uuid = any(media_ids)
          and moderation_state = 'PUBLISHED'
      ) as published
    `;
    return row?.published ?? false;
  }

  async replaySalesContent(command: ContentMutation) {
    return this.#sql.begin(async (transaction) => {
      const replay = await this.replay(
        transaction as unknown as Sql,
        "PublishSalesContent.v1",
        command,
      );
      return replay ? salesContentContract.parse(replay) : undefined;
    });
  }

  async replayPurchaseExperience(command: ContentMutation) {
    return this.#sql.begin(async (transaction) => {
      const replay = await this.replay(
        transaction as unknown as Sql,
        "PublishPurchaseExperience.v1",
        command,
      );
      return replay ? purchaseExperienceContract.parse(replay) : undefined;
    });
  }

  async replayReplaceSellerSalesContent(command: ContentMutation) {
    return this.#sql.begin(async (transaction) => {
      const replay = await this.replay(
        transaction as unknown as Sql,
        "ReplaceSellerSalesContent.v2",
        command,
      );
      return replay ? sellerSalesContentItemV2Contract.parse(replay) : undefined;
    });
  }

  async listSellerSalesContent(input: { actorId: string; storeId: string }) {
    return sellerSalesContentListV2Contract.parse({
      storeId: input.storeId,
      items: await this.readSellerItems(input.actorId),
    });
  }

  async readSellerSalesContent(input: { actorId: string; contentId: string }) {
    return (await this.readSellerItems(input.actorId, input.contentId))[0];
  }

  async hasPurchaseExperience(orderItemId: string) {
    const [row] = await this.#sql<Array<{ exists: boolean }>>`
      select exists (
        select 1 from content_purchase_experiences
        where order_item_id = ${orderItemId}
      ) as "exists"
    `;
    return row?.exists ?? false;
  }

  async readProductPurchaseExperiences(productId: string) {
    const [summary] = await this.#sql<
      Array<{ verifiedPurchaseCount: number; averageRating: number | null }>
    >`
      select count(*)::int as "verifiedPurchaseCount",
        case when count(*) >= 3
          then round(avg(rating)::numeric, 1)::float
          else null
        end as "averageRating"
      from content_purchase_experiences
      where product_id = ${productId}
        and moderation_state = 'PUBLISHED'
    `;
    const experiences = await this.#sql<
      Array<{
        experienceId: string;
        source: string;
        moderationState: string;
        rating: number;
        text: string;
        mediaIds: string[];
        createdAt: Date;
      }>
    >`
      select id as "experienceId", source,
        moderation_state as "moderationState", rating, text,
        media_ids as "mediaIds", created_at as "createdAt"
      from content_purchase_experiences
      where product_id = ${productId}
        and moderation_state = 'PUBLISHED'
      order by created_at desc, id desc
      limit 20
    `;
    return productPurchaseExperiencesContract.parse({
      productId,
      summary: summary ?? { verifiedPurchaseCount: 0, averageRating: null },
      experiences: experiences.map((experience) => ({
        ...experience,
        createdAt: experience.createdAt.toISOString(),
      })),
    });
  }

  async readPublicSalesContent(storeIds: readonly string[]) {
    const rows = await this.#sql<
      Array<{
        contentId: string;
        storeId: string;
        source: "SELLER";
        mediaId: string;
        mediaKind: "IMAGE" | "VIDEO";
        productId: string;
        active: boolean;
        publishedAt: Date;
      }>
    >`
      with selected as (
        select content.content_id, content.store_id, content.source,
          content.media_id, content.media_kind, content.published_at
        from content_public_sales_contents content
        join content_public_store_states store on store.store_id = content.store_id
          and store.published
        where content.store_id in ${this.#sql(storeIds)}
          and content.moderation_state = 'PUBLISHED'
        order by content.published_at desc, content.content_id desc
        limit 60
      )
      select selected.content_id as "contentId", selected.store_id as "storeId",
        selected.source, selected.media_id as "mediaId",
        selected.media_kind as "mediaKind", product.product_id as "productId",
        product.active, selected.published_at as "publishedAt"
      from selected
      join content_public_sales_content_products product
        on product.content_id = selected.content_id
      order by selected.published_at desc, selected.content_id desc,
        product.product_id
    `;
    const [status] = await this.#sql<Array<{ updatedAt: Date }>>`
      select updated_at as "updatedAt"
      from content_public_sales_content_status
      where projection_name = 'public-sales-content-v2'
    `;
    const byContent = new Map<
      string,
      {
        contentId: string;
        source: "SELLER";
        storeId: string;
        media: { mediaId: string; kind: "IMAGE" | "VIDEO" };
        products: Array<{ productId: string; active: boolean }>;
        publishedAt: string;
      }
    >();
    for (const row of rows) {
      const item = byContent.get(row.contentId) ?? {
        contentId: row.contentId,
        source: row.source,
        storeId: row.storeId,
        media: { mediaId: row.mediaId, kind: row.mediaKind },
        products: [],
        publishedAt: row.publishedAt.toISOString(),
      };
      item.products.push({ productId: row.productId, active: row.active });
      byContent.set(row.contentId, item);
    }
    return publicSalesContentFeedV2Contract.parse({
      projectionUpdatedAt: (status?.updatedAt ?? new Date(0)).toISOString(),
      items: [...byContent.values()],
    });
  }

  async publishSalesContent(
    command: Parameters<ContentRepository["publishSalesContent"]>[0],
  ) {
    return this.#sql.begin(async (transaction) => {
      const sql = transaction as unknown as Sql;
      const replay = await this.replay(sql, "PublishSalesContent.v1", command);
      if (replay) return salesContentContract.parse(replay);

      for (const product of [...command.products].sort((left, right) =>
        left.productId.localeCompare(right.productId),
      )) {
        await sql`
          select pg_advisory_xact_lock(
            hashtextextended(${`content-product-state:${product.productId}`}, 0)
          )
        `;
        const [projected] = await sql<
          Array<{ active: boolean; publicationVersion: number }>
        >`
          select active, publication_version as "publicationVersion"
          from content_product_states
          where product_id = ${product.productId}
        `;
        if (
          projected &&
          (projected.publicationVersion > product.publicationVersion ||
            (projected.publicationVersion === product.publicationVersion &&
              !projected.active))
        ) {
          throw new ContentFault("NO_ACTIVE_PRODUCT");
        }
      }

      const contentId = randomUUID();
      const occurredAt = new Date().toISOString();
      const response = salesContentContract.parse({
        contentId,
        source: "SELLER",
        moderationState: "PUBLISHED",
      });
      await sql`
        insert into content_sales_contents
          (id, store_id, actor_identity_id, source, moderation_state,
           media_id, media_kind, active, created_at)
        values
          (${contentId}, ${command.input.storeId}, ${command.actorId}, 'SELLER',
           'PUBLISHED', ${command.input.media.mediaId}, ${command.input.media.kind},
           true, ${occurredAt})
      `;
      for (const product of command.products) {
        await sql`
          insert into content_sales_content_products
            (content_id, product_id, publication_version, active)
          values
            (${contentId}, ${product.productId}, ${product.publicationVersion}, true)
        `;
      }
      await this.audit(
        sql,
        "SALES_CONTENT",
        contentId,
        command,
        "PublishSalesContent.v1",
      );
      await enqueueOutboxEvent(
        sql,
        salesContentPublishedV1Contract.parse({
          version: 1,
          eventId: randomUUID(),
          eventType: "SalesContentPublished.v1",
          aggregateId: contentId,
          aggregateVersion: 1,
          occurredAt,
          correlationId: command.correlationId,
          causationId: command.correlationId,
          actor: { type: "SYSTEM" },
          payload: {
            contentId,
            source: "SELLER",
            storeId: command.input.storeId,
            media: command.input.media,
            productIds: command.input.productIds,
            moderationState: "PUBLISHED",
          },
        }),
      );
      await this.remember(sql, "PublishSalesContent.v1", command, response);
      return response;
    });
  }

  async replaceSellerSalesContent(
    command: Parameters<ContentRepository["replaceSellerSalesContent"]>[0],
  ) {
    return this.#sql.begin(async (transaction) => {
      const sql = transaction as unknown as Sql;
      const replay = await this.replay(sql, "ReplaceSellerSalesContent.v2", command);
      if (replay) return sellerSalesContentItemV2Contract.parse(replay);
      const [current] = await sql<
        Array<{
          actorId: string;
          storeId: string;
          moderationState: "PUBLISHED" | "HIDDEN";
          createdAt: Date;
          revision: number;
        }>
      >`
        select actor_identity_id as "actorId", store_id as "storeId",
          moderation_state as "moderationState", created_at as "createdAt", revision
        from content_sales_contents
        where id = ${command.contentId}
        for update
      `;
      if (
        !current ||
        current.actorId !== command.actorId ||
        current.storeId !== command.storeId
      ) {
        throw new ContentFault("CONTENT_NOT_FOUND");
      }
      if (current.revision !== command.input.expectedRevision) {
        throw new ContentFault("REVISION_CONFLICT");
      }
      for (const product of [...command.products].sort((left, right) =>
        left.productId.localeCompare(right.productId),
      )) {
        await sql`
          select pg_advisory_xact_lock(
            hashtextextended(${`content-product-state:${product.productId}`}, 0)
          )
        `;
        const [projected] = await sql<
          Array<{ active: boolean; publicationVersion: number }>
        >`
          select active, publication_version as "publicationVersion"
          from content_product_states where product_id = ${product.productId}
        `;
        if (
          projected &&
          (projected.publicationVersion > product.publicationVersion ||
            (projected.publicationVersion === product.publicationVersion &&
              !projected.active))
        ) {
          throw new ContentFault("NO_ACTIVE_PRODUCT");
        }
      }
      const updatedAt = new Date().toISOString();
      const revision = current.revision + 1;
      await sql`
        update content_sales_contents
        set media_id = ${command.input.media.mediaId},
          media_kind = ${command.input.media.kind}, active = true,
          revision = ${revision}, updated_at = ${updatedAt}
        where id = ${command.contentId}
      `;
      await sql`
        delete from content_sales_content_products
        where content_id = ${command.contentId}
          and product_id not in ${sql(command.products.map(({ productId }) => productId))}
      `;
      for (const product of command.products) {
        await sql`
          insert into content_sales_content_products
            (content_id, product_id, publication_version, active)
          values (${command.contentId}, ${product.productId},
            ${product.publicationVersion}, true)
          on conflict (content_id, product_id) do update set
            publication_version = excluded.publication_version, active = true
        `;
      }
      await this.audit(
        sql,
        "SALES_CONTENT",
        command.contentId,
        command,
        "ReplaceSellerSalesContent.v2",
      );
      await enqueueOutboxEvent(
        sql,
        salesContentPublishedV1Contract.parse({
          version: 1,
          eventId: randomUUID(),
          eventType: "SalesContentPublished.v1",
          aggregateId: command.contentId,
          aggregateVersion: revision,
          occurredAt: updatedAt,
          correlationId: command.correlationId,
          causationId: command.correlationId,
          actor: { type: "SYSTEM" },
          payload: {
            contentId: command.contentId,
            source: "SELLER",
            storeId: command.storeId,
            media: command.input.media,
            productIds: command.input.productIds,
            moderationState: "PUBLISHED",
          },
        }),
      );
      const response = sellerSalesContentItemV2Contract.parse({
        contentId: command.contentId,
        source: "SELLER",
        moderationState: current.moderationState,
        storeId: command.storeId,
        media: command.input.media,
        products: command.products.map((product) => ({ ...product, active: true })),
        active: true,
        revision,
        createdAt: current.createdAt.toISOString(),
        updatedAt,
      });
      await this.remember(sql, "ReplaceSellerSalesContent.v2", command, response);
      return response;
    });
  }

  private async readSellerItems(actorId: string, contentId?: string) {
    const rows = await this.#sql<
      Array<{
        contentId: string;
        source: "SELLER";
        moderationState: "PUBLISHED" | "HIDDEN";
        storeId: string;
        mediaId: string;
        mediaKind: "IMAGE";
        productId: string;
        publicationVersion: number;
        productActive: boolean;
        active: boolean;
        revision: number;
        createdAt: Date;
        updatedAt: Date;
      }>
    >`
      with selected_content as (
        select id
        from content_sales_contents
        where actor_identity_id = ${actorId}
          and (${contentId ?? null}::uuid is null or id = ${contentId ?? null}::uuid)
        order by updated_at desc, id desc
        limit ${contentId ? 1 : 60}
      )
      select content.id as "contentId", content.source,
        content.moderation_state as "moderationState", content.store_id as "storeId",
        content.media_id as "mediaId", content.media_kind as "mediaKind",
        product.product_id as "productId",
        product.publication_version as "publicationVersion",
        product.active as "productActive", content.active, content.revision,
        content.created_at as "createdAt", content.updated_at as "updatedAt"
      from content_sales_contents content
      join selected_content selected on selected.id = content.id
      join content_sales_content_products product on product.content_id = content.id
      order by content.updated_at desc, content.id desc, product.product_id
    `;
    const items = new Map<string, Record<string, unknown> & { products: unknown[] }>();
    for (const row of rows) {
      const item = items.get(row.contentId) ?? {
        contentId: row.contentId,
        source: row.source,
        moderationState: row.moderationState,
        storeId: row.storeId,
        media: { mediaId: row.mediaId, kind: row.mediaKind },
        products: [],
        active: row.active,
        revision: row.revision,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      };
      item.products.push({
        productId: row.productId,
        publicationVersion: row.publicationVersion,
        active: row.productActive,
      });
      items.set(row.contentId, item);
    }
    return [...items.values()].map((item) =>
      sellerSalesContentItemV2Contract.parse(item),
    );
  }

  async publishPurchaseExperience(
    command: Parameters<ContentRepository["publishPurchaseExperience"]>[0],
  ) {
    return this.#sql.begin(async (transaction) => {
      const sql = transaction as unknown as Sql;
      const replay = await this.replay(sql, "PublishPurchaseExperience.v1", command);
      if (replay) return purchaseExperienceContract.parse(replay);
      await sql`
        select pg_advisory_xact_lock(
          hashtextextended(${`content-experience:${command.input.orderItemId}`}, 0)
        )
      `;
      const duplicate = await sql`
        select 1 from content_purchase_experiences
        where order_item_id = ${command.input.orderItemId}
      `;
      if (duplicate.length) throw new ContentFault("ALREADY_SUBMITTED");

      const experienceId = randomUUID();
      const occurredAt = new Date().toISOString();
      const response = purchaseExperienceContract.parse({
        experienceId,
        source: "VERIFIED_PURCHASE",
        moderationState: "PUBLISHED",
      });
      await sql`
        insert into content_purchase_experiences
          (id, buyer_identity_id, order_item_id, store_id, product_id, source,
           moderation_state, rating, text, media_ids, created_at)
        values
          (${experienceId}, ${command.actorId}, ${command.input.orderItemId},
           ${command.storeId}, ${command.productId}, 'VERIFIED_PURCHASE', 'PUBLISHED',
           ${command.input.rating}, ${command.input.text},
           ${command.input.mediaIds}, ${occurredAt})
      `;
      await this.audit(
        sql,
        "PURCHASE_EXPERIENCE",
        experienceId,
        command,
        "PublishPurchaseExperience.v1",
      );
      await enqueueOutboxEvent(
        sql,
        purchaseExperiencePublishedV1Contract.parse({
          version: 1,
          eventId: randomUUID(),
          eventType: "PurchaseExperiencePublished.v1",
          aggregateId: experienceId,
          aggregateVersion: 1,
          occurredAt,
          correlationId: command.correlationId,
          causationId: command.correlationId,
          actor: { type: "SYSTEM" },
          payload: {
            experienceId,
            source: "VERIFIED_PURCHASE",
            storeId: command.storeId,
            productId: command.productId,
            rating: command.input.rating,
            text: command.input.text,
            mediaIds: command.input.mediaIds,
            moderationState: "PUBLISHED",
          },
        }),
      );
      await this.remember(sql, "PublishPurchaseExperience.v1", command, response);
      return response;
    });
  }

  private async replay(sql: Sql, operation: string, command: ContentMutation) {
    const [lock] = await sql<Array<{ acquired: boolean }>>`
      select pg_try_advisory_xact_lock(
        hashtextextended(${`${operation}:${command.actorId}:${command.idempotencyKey}`}, 0)
      ) as acquired
    `;
    if (!lock?.acquired) throw new ContentFault("IDEMPOTENCY_IN_PROGRESS");
    const [record] = await sql<IdempotencyRecord[]>`
      select request_hash as "requestHash", response_json as response
      from content_idempotency_records
      where operation = ${operation} and actor_id = ${command.actorId}
        and key = ${command.idempotencyKey}
    `;
    if (!record) return undefined;
    if (record.requestHash !== command.requestHash) {
      throw new ContentFault("IDEMPOTENCY_CONFLICT");
    }
    return record.response;
  }

  private async remember(
    sql: Sql,
    operation: string,
    command: ContentMutation,
    response: JSONValue,
  ) {
    await sql`
      insert into content_idempotency_records
        (operation, actor_id, key, request_hash, response_json)
      values
        (${operation}, ${command.actorId}, ${command.idempotencyKey},
         ${command.requestHash}, ${sql.json(response)})
    `;
  }

  private async audit(
    sql: Sql,
    aggregateKind: string,
    aggregateId: string,
    command: ContentMutation,
    operation: string,
  ) {
    await sql`
      insert into content_audits
        (id, aggregate_kind, aggregate_id, actor_identity_id, operation,
         outcome, correlation_id)
      values
        (${randomUUID()}, ${aggregateKind}, ${aggregateId}, ${command.actorId},
         ${operation}, 'SUCCESS', ${command.correlationId})
    `;
  }
}
