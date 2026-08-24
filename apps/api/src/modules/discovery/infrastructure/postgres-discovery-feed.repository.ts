import postgres, { type Sql } from "postgres";
import { discoveryFeedProjectionEventTypes } from "@sevo/contracts/discovery/v1";

import type {
  DiscoveryFeedProjectionCandidate,
  DiscoveryFeedRepository,
} from "../public";

type StatusRow = {
  healthy: boolean;
  reason: string | null;
  updatedAt: Date;
  pendingEvents: number;
  unresolvedBuffers: number;
};

export class PostgresDiscoveryFeedRepository implements DiscoveryFeedRepository {
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

  async onModuleDestroy() {
    await this.#sql.end();
  }
}
