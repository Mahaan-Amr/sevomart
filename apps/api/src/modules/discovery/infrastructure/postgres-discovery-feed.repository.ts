import postgres, { type Sql } from "postgres";
import { discoveryFeedProjectionEventTypes } from "@sevo/contracts/discovery/v1";

import type {
  DiscoveryFeedProjectionCandidate,
  DiscoveryFeedRepository,
  FollowingFeedRepository,
} from "../public";

type StatusRow = {
  healthy: boolean;
  reason: string | null;
  updatedAt: Date;
  pendingEvents: number;
  unresolvedBuffers: number;
};

type RankedFollowingRow = DiscoveryFeedProjectionCandidate & {
  publicationDayUtc: string;
  storeOrdinal: number;
};

export class PostgresDiscoveryFeedRepository
  implements DiscoveryFeedRepository, FollowingFeedRepository
{
  readonly #sql: Sql;

  constructor(databaseUrl: string) {
    this.#sql = postgres(databaseUrl, { max: 5 });
  }

  async readPublicSnapshot(snapshotAt: Date) {
    const statusRows = await this.#sql<StatusRow[]>`
      select status.healthy, status.reason, status.updated_at as "updatedAt",
        (select count(*)::int
         from platform_outbox_events event
         left join platform_outbox_consumptions consumption
           on consumption.event_id = event.event_id
          and consumption.consumer_name = 'discovery-public-feed-v1'
         where event.event_type in ${this.#sql(discoveryFeedProjectionEventTypes)}
           and consumption.event_id is null) as "pendingEvents",
        (select count(*)::int
         from discovery_product_feed_version_buffers) as "unresolvedBuffers"
      from discovery_projection_status status
      where status.projection_name = 'public-feed-v1'
    `;
    const status = statusRows[0];
    if (!status) {
      return {
        healthy: false,
        reason: "STATUS_MISSING",
        projectionUpdatedAt: new Date(0),
        candidates: [],
      };
    }
    if (!status.healthy || status.pendingEvents > 0 || status.unresolvedBuffers > 0) {
      return {
        healthy: false,
        reason:
          status.unresolvedBuffers > 0
            ? "UNRESOLVED_BUFFERS"
            : status.pendingEvents > 0
              ? "PENDING_EVENTS"
              : (status.reason ?? "UNHEALTHY"),
        projectionUpdatedAt: status.updatedAt,
        candidates: [],
      };
    }
    const candidates = await this.#sql<DiscoveryFeedProjectionCandidate[]>`
      select product.product_id as "productId", product.store_id as "storeId",
        product.first_published_at as "firstPublishedAt",
        product.eligible_since as "eligibleSince",
        store.publication_version as "storePublicationVersion",
        product.publication_version as "publicationVersion",
        product.offer_version as "offerVersion",
        product.availability_version as "availabilityVersion"
      from discovery_product_feed_projections product
      join discovery_store_feed_projections store
        on store.store_id = product.store_id
      where product.published = true and store.published = true
        and product.eligible_since <= ${snapshotAt}
      order by product.first_published_at desc, product.product_id
    `;
    return {
      healthy: true,
      projectionUpdatedAt: status.updatedAt,
      candidates,
    };
  }

  async readFollowingSnapshot(
    identityId: string,
    snapshotAt: Date,
    page: {
      seek?: import("../public").FollowingFeedRankingKey;
      limit: number;
    },
  ) {
    return this.#sql.begin("isolation level repeatable read read only", async (sql) => {
      const statusRows = await sql<StatusRow[]>`
          select status.healthy, status.reason, status.updated_at as "updatedAt",
            (select count(*)::int
             from platform_outbox_events event
             left join platform_outbox_consumptions consumption
               on consumption.event_id = event.event_id
              and consumption.consumer_name = 'discovery-public-feed-v1'
             where event.event_type in ${sql(discoveryFeedProjectionEventTypes)}
               and consumption.event_id is null) as "pendingEvents",
            (select count(*)::int
             from discovery_product_feed_version_buffers) as "unresolvedBuffers"
          from discovery_projection_status status
          where status.projection_name = 'public-feed-v1'
        `;
      const status = statusRows[0];
      if (
        !status ||
        !status.healthy ||
        status.pendingEvents > 0 ||
        status.unresolvedBuffers > 0
      ) {
        return {
          healthy: false as const,
          reason: !status
            ? "STATUS_MISSING"
            : status.unresolvedBuffers > 0
              ? "UNRESOLVED_BUFFERS"
              : status.pendingEvents > 0
                ? "PENDING_EVENTS"
                : (status.reason ?? "UNHEALTHY"),
          projectionUpdatedAt: status?.updatedAt ?? new Date(0),
          followSetRevision: 0,
          visibleFollowedStoreCount: 0,
          candidates: [],
        };
      }
      const revisionRows = await sql<Array<{ revision: number }>>`
          select revision from discovery_follow_sets where identity_id = ${identityId}
        `;
      const countRows = await sql<Array<{ count: number }>>`
          select count(distinct follow.store_id)::int as count
          from discovery_store_follows follow
          join discovery_store_feed_projections store
            on store.store_id = follow.store_id and store.published = true
          where follow.identity_id = ${identityId} and follow.status = 'ACTIVE'
        `;
      const candidates = await sql<RankedFollowingRow[]>`
          with ranked as (
            select product.product_id as "productId",
              product.store_id as "storeId",
              product.first_published_at as "firstPublishedAt",
              product.eligible_since as "eligibleSince",
              store.publication_version as "storePublicationVersion",
              product.publication_version as "publicationVersion",
              product.offer_version as "offerVersion",
              product.availability_version as "availabilityVersion",
              to_char(product.first_published_at at time zone 'UTC', 'YYYY-MM-DD')
                as "publicationDayUtc",
              (row_number() over (
                partition by date_trunc('day', product.first_published_at at time zone 'UTC'),
                  product.store_id
                order by product.first_published_at desc, product.product_id
              ) - 1)::int as "storeOrdinal"
            from discovery_store_follows follow
            join discovery_store_feed_projections store
              on store.store_id = follow.store_id
            join discovery_product_feed_projections product
              on product.store_id = follow.store_id
            where follow.identity_id = ${identityId} and follow.status = 'ACTIVE'
              and store.published = true and product.published = true
              and product.eligible_since <= ${snapshotAt}
          )
          select * from ranked
          where ${
            page.seek
              ? sql`
                ("publicationDayUtc" < ${page.seek.publicationDayUtc}
                  or ("publicationDayUtc" = ${page.seek.publicationDayUtc} and (
                    "storeOrdinal" > ${page.seek.storeOrdinal}
                    or ("storeOrdinal" = ${page.seek.storeOrdinal} and (
                      "storeId" > ${page.seek.storeId}
                      or ("storeId" = ${page.seek.storeId} and (
                        "firstPublishedAt" < ${page.seek.firstPublishedAt}
                        or ("firstPublishedAt" = ${page.seek.firstPublishedAt}
                          and "productId" > ${page.seek.productId})
                      ))
                    ))
                  )))
              `
              : sql`true`
          }
          order by "publicationDayUtc" desc, "storeOrdinal", "storeId",
            "firstPublishedAt" desc, "productId"
          limit ${page.limit}
        `;
      return {
        healthy: true as const,
        projectionUpdatedAt: status.updatedAt,
        followSetRevision: revisionRows[0]?.revision ?? 0,
        visibleFollowedStoreCount: countRows[0]?.count ?? 0,
        candidates: candidates.map((candidate) => ({
          candidate,
          key: {
            publicationDayUtc: candidate.publicationDayUtc,
            storeOrdinal: candidate.storeOrdinal,
            storeId: candidate.storeId,
            firstPublishedAt: candidate.firstPublishedAt.toISOString(),
            productId: candidate.productId,
          },
        })),
      };
    });
  }

  async onModuleDestroy() {
    await this.#sql.end();
  }
}
