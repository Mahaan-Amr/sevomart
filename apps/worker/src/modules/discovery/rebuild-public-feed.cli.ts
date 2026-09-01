import { readRuntimeEnvironment } from "@sevo/config";
import { startTelemetry } from "@sevo/observability";

import { rebuildDiscoveryProjections } from "./rebuild-discovery-projections";

async function run() {
  if (process.env.SEVO_REBUILD_CONFIRM !== "discovery-projections-v1") {
    throw new Error(
      "Set SEVO_REBUILD_CONFIRM=discovery-projections-v1 to confirm the discovery rebuild",
    );
  }
  const environment = readRuntimeEnvironment();
  const telemetry = startTelemetry("sevo-worker-discovery-rebuild");
  try {
    const result = await rebuildDiscoveryProjections(environment.DATABASE_URL);
    if (!result.publicFeed.health.healthy) process.exitCode = 2;
  } finally {
    await telemetry.shutdown();
  }
}

void run().catch((error: unknown) => {
  console.error(
    JSON.stringify({
      level: "error",
      message: "discovery_projection_rebuild_command_failed",
      errorKind: error instanceof Error ? error.name : "UnknownError",
    }),
  );
  process.exitCode = 1;
});
