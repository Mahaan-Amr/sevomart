import { readRuntimeEnvironment } from "@sevo/config";
import { describe, expect, it } from "vitest";

const common = {
  API_PORT: "3001",
  WEB_ORIGIN: "https://sevo.example",
  OTEL_EXPORTER_OTLP_ENDPOINT: "",
  DEV_OTP_TEST_MOBILES: "09123456789",
};

describe("runtime trust guard", () => {
  it("allows optimized JavaScript images to use development-only adapters", () => {
    expect(
      readRuntimeEnvironment({
        ...common,
        NODE_ENV: "production",
        SEVO_RUNTIME_ENV: "development",
        DATABASE_URL: "postgresql://sevo:sevo_local@database:5432/sevo",
        OTP_PROVIDER: "dev",
      }),
    ).toMatchObject({ NODE_ENV: "production", SEVO_RUNTIME_ENV: "development" });
  });

  it("rejects local credentials and development OTP at production trust", () => {
    expect(() =>
      readRuntimeEnvironment({
        ...common,
        NODE_ENV: "production",
        SEVO_RUNTIME_ENV: "production",
        DATABASE_URL: "postgresql://sevo:sevo_local@database:5432/sevo",
        OTP_PROVIDER: "dev",
      }),
    ).toThrow("Production trust requires external OTP");
  });

  it("rejects local or non-TLS object storage at production trust", () => {
    expect(() =>
      readRuntimeEnvironment({
        ...common,
        NODE_ENV: "production",
        SEVO_RUNTIME_ENV: "production",
        DATABASE_URL: "postgresql://sevo:strong-password@database.example:5432/sevo",
        OTP_PROVIDER: "external",
        MINIO_ENDPOINT: "127.0.0.1",
        MINIO_PORT: "9000",
        MINIO_USE_SSL: "false",
        MINIO_ACCESS_KEY: "production-access",
        MINIO_SECRET_KEY: "production-secret-value",
        MINIO_BUCKET: "production-media",
      }),
    ).toThrow("persistent TLS object storage");
  });

  it("accepts explicitly external production services", () => {
    expect(
      readRuntimeEnvironment({
        ...common,
        NODE_ENV: "production",
        SEVO_RUNTIME_ENV: "production",
        DATABASE_URL: "postgresql://sevo:strong-password@database.example:5432/sevo",
        OTP_PROVIDER: "external",
        MINIO_ENDPOINT: "objects.example.com",
        MINIO_PORT: "443",
        MINIO_USE_SSL: "true",
        MINIO_ACCESS_KEY: "production-access",
        MINIO_SECRET_KEY: "production-secret-value",
        MINIO_BUCKET: "production-media",
        SELLER_APPROVAL_RECOVERY_SECRET: "production-seller-approval-recovery-secret",
        CART_TOKEN_DERIVATION_SECRET: "production-cart-token-derivation-secret",
      }),
    ).toMatchObject({ SEVO_RUNTIME_ENV: "production", MINIO_USE_SSL: true });
  });

  it("rejects the local seller approval recovery secret at production trust", () => {
    expect(() =>
      readRuntimeEnvironment({
        ...common,
        NODE_ENV: "production",
        SEVO_RUNTIME_ENV: "production",
        DATABASE_URL: "postgresql://sevo:strong-password@database.example:5432/sevo",
        OTP_PROVIDER: "external",
        MINIO_ENDPOINT: "objects.example.com",
        MINIO_PORT: "443",
        MINIO_USE_SSL: "true",
        MINIO_ACCESS_KEY: "production-access",
        MINIO_SECRET_KEY: "production-secret-value",
        MINIO_BUCKET: "production-media",
      }),
    ).toThrow("non-default secrets");
  });
});
