import { createServer } from "node:http";

import { readRuntimeEnvironment } from "@sevo/config";
import { startTelemetry } from "@sevo/observability";

async function run(): Promise<void> {
  const environment = readRuntimeEnvironment();
  const telemetry = startTelemetry("sevo-worker");
  const server = createServer((request, response) => {
    if (request.url === "/health/live" || request.url === "/health/ready") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ status: "ok", service: "worker", version: 1 }));
      return;
    }
    response.writeHead(404).end();
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(environment.WORKER_PORT, "0.0.0.0", resolve);
  });
  console.log(
    JSON.stringify({
      level: "info",
      message: "worker_ready",
      environment: environment.NODE_ENV,
      runtimeEnvironment: environment.SEVO_RUNTIME_ENV,
    }),
  );
  await new Promise<void>((resolve) => {
    process.once("SIGINT", resolve);
    process.once("SIGTERM", resolve);
  });
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
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
