import { createServer } from "node:http";

import { afterEach, describe, expect, it } from "vitest";

import {
  getMeter,
  getTracer,
  startTelemetry,
} from "../../packages/observability/src/index";

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

  it("exports metrics and privacy-filtered traces to the configured OTLP endpoint", async () => {
    const paths: string[] = [];
    const traceBodies: Buffer[] = [];
    const server = createServer((request, response) => {
      paths.push(request.url ?? "");
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        if (request.url === "/v1/traces") traceBodies.push(Buffer.concat(chunks));
        response.writeHead(200).end();
      });
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
    const span = getTracer("sevo-observability-test").startSpan(
      "PRIVATE_MEDIA_MARKER",
      {
        attributes: {
          "url.full": "/v1/media/PRIVATE_MEDIA_MARKER?caption=PRIVATE_CAPTION_MARKER",
          "url.path": "/v1/media/PRIVATE_MEDIA_MARKER",
          "http.request.method": "GET",
        },
      },
    );
    span.addEvent("PRIVATE_CAPTION_MARKER");
    span.setStatus({ code: 2, message: "PRIVATE_CAPTION_MARKER" });
    span.end();
    await telemetry.shutdown();

    expect(paths).toContain("/v1/metrics");
    expect(traceBodies.length).toBeGreaterThan(0);
    expect(
      Buffer.concat(traceBodies).includes(Buffer.from("PRIVATE_MEDIA_MARKER")),
    ).toBe(false);
    expect(
      Buffer.concat(traceBodies).includes(Buffer.from("PRIVATE_CAPTION_MARKER")),
    ).toBe(false);
  });
});
