import {
  productPublishedV1Contract,
  type ProductPublishedV2,
} from "@sevo/contracts/product/v1";
import type { StoredOutboxEvent } from "@sevo/outbox";

// The feed projects only canonical version metadata, never event display content.
export type ProductPublicationMetadata = Pick<
  ProductPublishedV2,
  "aggregateVersion" | "occurredAt"
> & {
  payload: Omit<ProductPublishedV2["payload"], "snapshot">;
};

// Kept only for durable v1 history/catch-up. New producers publish v2.
// A v1 summary cannot be converted to a v2 snapshot: it has no variant identities.
export function readLegacyProductPublication(
  event: StoredOutboxEvent,
): ProductPublicationMetadata {
  const legacy = productPublishedV1Contract.parse(event);
  return {
    aggregateVersion: legacy.aggregateVersion,
    occurredAt: legacy.occurredAt,
    payload: {
      storeId: legacy.payload.storeId,
      productId: legacy.payload.productId,
      publicationVersion: legacy.payload.publicationVersion,
      offerVersion: legacy.payload.offerVersion,
      availabilityVersion: legacy.payload.availabilityVersion,
    },
  };
}
