import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { metrics } from "@opentelemetry/api";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { NodeSDK } from "@opentelemetry/sdk-node";

export type TelemetryHandle = { shutdown(): Promise<void> };

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
    traceExporter: new OTLPTraceExporter({
      url: `${endpoint.replace(/\/$/, "")}/v1/traces`,
    }),
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
