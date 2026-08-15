import "reflect-metadata";

import { startTelemetry } from "@sevo/observability";

const telemetry = startTelemetry("sevo-api");

void import("./main.js")
  .then(({ bootstrap }) => bootstrap(telemetry))
  .catch(async (error: unknown) => {
    console.error(error);
    await telemetry.shutdown();
    process.exitCode = 1;
  });
