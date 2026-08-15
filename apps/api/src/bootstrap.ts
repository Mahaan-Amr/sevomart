import "reflect-metadata";

import { startTelemetry } from "@sevo/observability";

const telemetry = startTelemetry("sevo-api");

void import("./main.js")
  .then(({ bootstrap }) => bootstrap(telemetry))
  .catch(async (error: unknown) => {
    console.error(
      JSON.stringify({
        level: "error",
        message: "api_start_failed",
        error: error instanceof Error ? error.message : "unknown_error",
      }),
    );
    await telemetry.shutdown();
    process.exitCode = 1;
  });
