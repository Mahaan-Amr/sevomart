import { identityStatusChangedV1Contract } from "@sevo/contracts/identity-access/v1";
import { DurableOutboxWorker, type OutboxEventHandler } from "@sevo/outbox";

import type { WorkerHandler } from "../public";
import {
  projectDiscoveryProductEvent,
  projectDiscoveryStoreEvent,
  reconcileDiscoveryProjectionHealth,
} from "./project-public-feed";

export const projectIdentityStatusForFollowerCount: OutboxEventHandler = async (
  event,
  sql,
) => {
  const changed = identityStatusChangedV1Contract.parse(event);
  if (changed.aggregateVersion !== changed.payload.statusVersion) {
    throw new Error("Identity status event versions do not match");
  }
  await sql`
    select pg_advisory_xact_lock(
      hashtextextended(${`discovery-identity:${changed.aggregateId}`}, 0)
    )
  `;
  const currentRows = await sql<
    Array<{ status: "ACTIVE" | "INACTIVE"; statusVersion: number }>
  >`
    select status, status_version as "statusVersion"
    from discovery_identity_status_projections
    where identity_id = ${changed.aggregateId}
    for update
  `;
  const current = currentRows[0];
  if (current && current.statusVersion >= changed.payload.statusVersion) return;

  await sql`
    insert into discovery_identity_status_projections
      (identity_id, status, status_version, updated_at)
    values
      (${changed.aggregateId}, ${changed.payload.status},
       ${changed.payload.statusVersion}, ${changed.occurredAt})
    on conflict (identity_id) do update set
      status = excluded.status,
      status_version = excluded.status_version,
      updated_at = excluded.updated_at
  `;
  if (current?.status === changed.payload.status) return;

  const stores = await sql<Array<{ storeId: string }>>`
    select store_id as "storeId"
    from discovery_store_follows
    where identity_id = ${changed.aggregateId} and status = 'ACTIVE'
    order by store_id
  `;
  const activates = changed.payload.status === "ACTIVE";
  for (const { storeId } of stores) {
    if (activates) {
      await sql`
        insert into discovery_public_follower_counts
          (store_id, follower_count, updated_at)
        values (${storeId}, 1, ${changed.occurredAt})
        on conflict (store_id) do update set
          follower_count = discovery_public_follower_counts.follower_count + 1,
          updated_at = excluded.updated_at
      `;
      continue;
    }
    const updated = await sql<Array<{ count: number }>>`
      update discovery_public_follower_counts
      set follower_count = follower_count - 1,
          updated_at = ${changed.occurredAt}
      where store_id = ${storeId} and follower_count > 0
      returning follower_count as count
    `;
    if (!updated[0]) throw new Error("Public follower count cannot become negative");
  }
};

const followerCountIdentityProjectionWorker: WorkerHandler = {
  async start(environment) {
    const worker = new DurableOutboxWorker(environment.DATABASE_URL, {
      consumerName: "discovery-follower-count-identity-v1",
      handlers: { "IdentityStatusChanged.v1": projectIdentityStatusForFollowerCount },
    });
    await worker.start();
    return () => worker.close();
  },
};

const publicDiscoveryProjectionWorker: WorkerHandler = {
  async start(environment) {
    const worker = new DurableOutboxWorker(environment.DATABASE_URL, {
      consumerName: "discovery-public-feed-v1",
      handlers: {
        "StorePublished.v1": projectDiscoveryStoreEvent,
        "StoreUnpublished.v1": projectDiscoveryStoreEvent,
        "ProductPublished.v1": projectDiscoveryProductEvent,
        "ProductPublished.v2": projectDiscoveryProductEvent,
        "ProductUnpublished.v1": projectDiscoveryProductEvent,
        "VariantPriceChanged.v1": projectDiscoveryProductEvent,
        "VariantAvailabilityChanged.v1": projectDiscoveryProductEvent,
      },
    });
    await worker.start();
    await reconcileDiscoveryProjectionHealth(environment.DATABASE_URL);
    return () => worker.close();
  },
};

export const discovery_workerHandlers: readonly WorkerHandler[] = [
  followerCountIdentityProjectionWorker,
  publicDiscoveryProjectionWorker,
];
