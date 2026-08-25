import { createServer } from "node:http";

import { afterEach, describe, expect, it } from "vitest";

import { getMeter, startTelemetry } from "../../packages/observability/src/index";

describe("OpenTelemetry metrics", () => {
  const servers: Array<ReturnType<typeof createServer>> = [];

  afterEach(async () => {
    await Promise.all(
      servers
        .splice(0)
        .map(
          (server) =>
            new Promise<void>((resolve, reject) =>
              server.close((error) => (error ? reject(error) : resolve())),
            ),
        ),
    );
  });

  it("flushes recorded metrics to the configured OTLP endpoint", async () => {
    const paths: string[] = [];
    const server = createServer((request, response) => {
      paths.push(request.url ?? "");
      request.resume();
      response.writeHead(200).end();
    });
    servers.push(server);
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing test port");

    const telemetry = startTelemetry(
      "sevo-observability-test",
      `http://127.0.0.1:${address.port}`,
    );
    getMeter("sevo-observability-test")
      .createCounter("sevo.test.recorded_events")
      .add(1);
    await telemetry.shutdown();

    expect(paths).toContain("/v1/metrics");
  });
});
