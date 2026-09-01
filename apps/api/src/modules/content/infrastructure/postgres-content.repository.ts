import { randomUUID } from "node:crypto";

import { productPurchaseExperiencesContract } from "@sevo/contracts/content/v2";
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
