import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { NodeSDK } from "@opentelemetry/sdk-node";

export type TelemetryHandle = { shutdown(): Promise<void> };

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
    instrumentations: [getNodeAutoInstrumentations()],
  });
  sdk.start();

  return {
    shutdown: () => sdk.shutdown(),
  };
}
