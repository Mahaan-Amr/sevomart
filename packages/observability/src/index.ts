import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { metrics, trace } from "@opentelemetry/api";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { NodeSDK } from "@opentelemetry/sdk-node";

export type TelemetryHandle = { shutdown(): Promise<void> };

export function getTracer(scopeName: string) {
  return trace.getTracer(scopeName);
}

export function getMeter(scopeName: string) {
  return metrics.getMeter(scopeName);
}

export function startTelemetry(
  serviceName: string,
  endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
): TelemetryHandle {
  if (!endpoint) {
    return { shutdown: async () => undefined };
  }

  const sdk = new NodeSDK({
    serviceName,
    traceExporter: privacySafeTraceExporter(
      new OTLPTraceExporter({
        url: `${endpoint.replace(/\/$/, "")}/v1/traces`,
      }),
    ),
    metricReaders: [
      new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter({
          url: `${endpoint.replace(/\/$/, "")}/v1/metrics`,
        }),
      }),
    ],
    instrumentations: [getNodeAutoInstrumentations()],
  });
  sdk.start();

  return {
    shutdown: () => sdk.shutdown(),
  };
}

// Automatic instrumentation can place private URLs and exception text in spans.
// Strip these at the export boundary, including child/client spans and events.
function privacySafeTraceExporter(exporter: OTLPTraceExporter) {
  const allowed = new Set([
    "http.request.method",
    "http.method",
    "http.response.status_code",
    "http.status_code",
    "server.port",
    "network.protocol.version",
  ]);
  return {
    export(
      spans: Parameters<OTLPTraceExporter["export"]>[0],
      callback: Parameters<OTLPTraceExporter["export"]>[1],
    ) {
      exporter.export(
        spans.map((span) => ({
          ...span,
          spanContext: () => span.spanContext(),
          name:
            span.kind === 1
              ? "server request"
              : span.kind === 2
                ? "client request"
                : "operation",
          attributes: Object.fromEntries(
            Object.entries(span.attributes).filter(([key]) => allowed.has(key)),
          ),
          events: [],
          links: span.links.map((link) => ({ context: link.context })),
          status: { code: span.status.code },
        })),
        callback,
      );
    },
    shutdown: () => exporter.shutdown(),
    forceFlush: () => exporter.forceFlush(),
  };
}
