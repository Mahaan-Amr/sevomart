import { DurableOutboxWorker } from "@sevo/outbox";

import { discoveryFollowerCountOutboxHandlers } from "../../apps/worker/src/modules/discovery";

export async function drainFollowerCountEvents(databaseUrl: string) {
  const worker = new DurableOutboxWorker(databaseUrl, {
    consumerName: "discovery-follower-count-v1",
    handlers: discoveryFollowerCountOutboxHandlers,
  });
  try {
    while ((await worker.runOnce()) !== "idle") {
      // Drain only follow and identity events owned by the count projection.
    }
  } finally {
    await worker.close();
  }
}
