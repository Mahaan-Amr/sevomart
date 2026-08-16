import { readRuntimeEnvironment } from "../../packages/config/src/index";

export const apiTestEnvironment = readRuntimeEnvironment({
  NODE_ENV: "test",
  API_PORT: "3001",
  WEB_ORIGIN: "http://localhost:3000",
  DATABASE_URL: "postgresql://sevo:sevo_local@localhost:6432/sevo",
  OTP_PROVIDER: "dev",
  DEV_OTP_TEST_MOBILES: "09123456789",
  OTEL_EXPORTER_OTLP_ENDPOINT: "",
});
