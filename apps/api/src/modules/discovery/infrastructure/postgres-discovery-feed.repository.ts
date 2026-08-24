import postgres, { type Sql } from "postgres";

import type {
  DiscoveryFeedProjectionCandidate,
  DiscoveryFeedRepository,
} from "../public";

type StatusRow = { healthy: boolean; reason: string | null; updatedAt: Date };

export class PostgresDiscoveryFeedRepository implements DiscoveryFeedRepository {
  readonly #sql: Sql;

  constructor(databaseUrl: string) {
    this.#sql = postgres(databaseUrl, { max: 5 });
  }

  async readPublicSnapshot(snapshotAt: Date) {
    const statusRows = await this.#sql<StatusRow[]>`
      select healthy, reason, updated_at as "updatedAt"
      from discovery_projection_status
      where projection_name = 'public-feed-v1'
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
    if (!status.healthy) {
      return {
        healthy: false,
        ...(status.reason ? { reason: status.reason } : {}),
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
