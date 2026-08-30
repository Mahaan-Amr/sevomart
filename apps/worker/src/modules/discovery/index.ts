import { discoveryProjectionOperationsV1 } from "@sevo/contracts/discovery/v1";
import { DurableOutboxWorker } from "@sevo/outbox";

import type { WorkerHandler } from "../public";
import {
  catchUpDiscoveryPublicFeedProjection,
  projectDiscoveryProductEvent,
  projectDiscoveryStoreEvent,
  reconcileDiscoveryProjectionHealth,
} from "./project-public-feed";
import {
  catchUpDiscoveryFollowerCountProjection,
  discoveryFollowerCountOutboxHandlers,
} from "./project-follower-count";

const followerCountIdentityProjectionWorker: WorkerHandler = {
  async start(environment) {
    await catchUpDiscoveryFollowerCountProjection(environment.DATABASE_URL);
    const worker = new DurableOutboxWorker(environment.DATABASE_URL, {
      consumerName: "discovery-follower-count-v1",
      handlers: discoveryFollowerCountOutboxHandlers,
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
    await catchUpDiscoveryPublicFeedProjection(environment.DATABASE_URL);
    await reconcileDiscoveryProjectionHealth(environment.DATABASE_URL);
    let monitoring: Promise<void> | undefined;
    const monitor = setInterval(() => {
      if (monitoring) return;
      monitoring = catchUpDiscoveryPublicFeedProjection(environment.DATABASE_URL)
        .then(() => reconcileDiscoveryProjectionHealth(environment.DATABASE_URL))
        .catch((error: unknown) => {
          console.error(
            JSON.stringify({
              level: "error",
              message: "discovery_projection_monitor_failed",
              errorKind: error instanceof Error ? error.name : "UnknownError",
            }),
          );
        })
        .finally(() => {
          monitoring = undefined;
        });
    }, discoveryProjectionOperationsV1.monitorIntervalMs);
    monitor.unref();
    return async () => {
      clearInterval(monitor);
      await monitoring;
      await worker.close();
    };
  },
};

export const discovery_workerHandlers: readonly WorkerHandler[] = [
  followerCountIdentityProjectionWorker,
  publicDiscoveryProjectionWorker,
];

export {
  catchUpDiscoveryFollowerCountProjection,
  discoveryFollowerCountOutboxHandlers,
  projectIdentityStatusForFollowerCount,
  projectStoreFollowForFollowerCount,
  rebuildDiscoveryFollowerCountProjection,
} from "./project-follower-count";
