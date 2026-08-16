import type { TelemetryHandle } from "@sevo/observability";
import { readRuntimeEnvironment } from "@sevo/config";

import { createApiApp } from "./create-app";

export async function bootstrap(telemetry: TelemetryHandle): Promise<void> {
  const environment = readRuntimeEnvironment();
  const app = await createApiApp(environment);

  const close = async () => {
    await app.close();
    await telemetry.shutdown();
  };
  process.once("SIGINT", close);
  process.once("SIGTERM", close);

  await app.listen(environment.API_PORT, "0.0.0.0");
}
