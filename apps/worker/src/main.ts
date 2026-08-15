import { readRuntimeEnvironment } from "@sevo/config";
import { startTelemetry } from "@sevo/observability";

async function run(): Promise<void> {
  const environment = readRuntimeEnvironment();
  const telemetry = startTelemetry("sevo-worker");

  console.log(
    JSON.stringify({
      level: "info",
      message: "worker_ready",
      environment: environment.NODE_ENV,
    }),
  );

  await new Promise<void>((resolve) => {
    process.once("SIGINT", resolve);
    process.once("SIGTERM", resolve);
  });
  await telemetry.shutdown();
}

void run().catch((error: unknown) => {
  console.error(
    JSON.stringify({
      level: "error",
      message: "worker_start_failed",
      error: error instanceof Error ? error.message : "unknown_error",
    }),
  );
  process.exitCode = 1;
});
