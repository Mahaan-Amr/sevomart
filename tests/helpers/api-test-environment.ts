import { readRuntimeEnvironment } from "../../packages/config/src/index";

export const apiTestEnvironment = readRuntimeEnvironment({
  NODE_ENV: "test",
  SEVO_RUNTIME_ENV: "test",
  API_PORT: "3001",
  WEB_ORIGIN: "http://localhost:3000",
  DATABASE_URL:
    process.env.DATABASE_URL ?? "postgresql://sevo:sevo_local@localhost:6432/sevo",
  MINIO_ENDPOINT: process.env.MINIO_ENDPOINT,
  MINIO_PORT: process.env.MINIO_PORT,
  MINIO_USE_SSL: process.env.MINIO_USE_SSL,
  MINIO_ACCESS_KEY: process.env.MINIO_ACCESS_KEY,
  MINIO_SECRET_KEY: process.env.MINIO_SECRET_KEY,
  MINIO_BUCKET: process.env.MINIO_BUCKET,
  OTP_PROVIDER: "dev",
  DIRECT_PAYMENT_PROVIDER: "dev",
  DEV_PAYMENT_PROVIDER_SIGNING_SECRET: "sevo_test_direct_payment_signing_secret",
  DEV_OTP_TEST_MOBILES: "09123456789",
  OTEL_EXPORTER_OTLP_ENDPOINT: "",
});
