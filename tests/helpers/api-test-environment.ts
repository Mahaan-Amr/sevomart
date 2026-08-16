import type { RuntimeEnvironment } from "@sevo/config";

export const apiTestEnvironment: RuntimeEnvironment = {
  NODE_ENV: "test",
  API_PORT: 3001,
  WEB_ORIGIN: "http://localhost:3000",
  DATABASE_URL: "postgresql://sevo:sevo_local@localhost:6432/sevo",
  OTEL_EXPORTER_OTLP_ENDPOINT: "",
};
