import { describe, expect, it } from "vitest";

import {
  assertQaScenarioCallbackEnvironment,
  assertQaScenarioProcessEnvironment,
  createQaScenarioCallbackEnvironment,
  createQaScenarioProcessEnvironment,
} from "../../scripts/qa/scenario-environment.mjs";

describe("QA scenario process environment", () => {
  it("preserves the native Windows Path spelling needed to launch pnpm", () => {
    const environment = createQaScenarioProcessEnvironment({ Path: "C:\\tools" });

    expect(environment.Path).toBe("C:\\tools");
  });

  it("removes inherited database targets and forces internal providers", () => {
    const environment = createQaScenarioProcessEnvironment({
      DATABASE_URL: "postgresql://human-data.example/sevo",
      MINIO_ENDPOINT: "objects.example.com",
      MINIO_SECRET_KEY: "human-secret",
      OTEL_EXPORTER_OTLP_ENDPOINT: "https://telemetry.example.com",
      OTP_PROVIDER: "external",
      SEVO_RUNTIME_ENV: "production",
    });

    expect(environment).toMatchObject({
      OTP_PROVIDER: "dev",
      SEVO_RUNTIME_ENV: "test",
    });
    expect(environment).not.toHaveProperty("DATABASE_URL");
    expect(environment).not.toHaveProperty("MINIO_ENDPOINT");
    expect(environment).not.toHaveProperty("MINIO_SECRET_KEY");
    expect(environment.OTEL_EXPORTER_OTLP_ENDPOINT).toBe("");
    expect(() => assertQaScenarioProcessEnvironment(environment)).not.toThrow();
  });

  it.each([
    {
      environment: {
        DATABASE_URL: "postgresql://human-data.example/sevo",
        OTP_PROVIDER: "dev",
        SEVO_RUNTIME_ENV: "test",
      },
      message: "DATABASE_URL",
    },
    {
      environment: { OTP_PROVIDER: "external", SEVO_RUNTIME_ENV: "test" },
      message: "provider",
    },
    {
      environment: { OTP_PROVIDER: "dev", SEVO_RUNTIME_ENV: "production" },
      message: "SEVO_RUNTIME_ENV=test",
    },
  ])("rejects unsafe callback process state", ({ environment, message }) => {
    expect(() => assertQaScenarioProcessEnvironment(environment)).toThrow(message);
  });

  it("builds the exact disposable callback targets from the lifecycle report", () => {
    const target = {
      databaseName: "sevo_qa_checkout_failure_a1b2c3d4e5f6",
      databasePort: 55432,
      minioPort: 59000,
    };
    const environment = createQaScenarioCallbackEnvironment(target, {
      DATABASE_URL: "postgresql://human-data.example/sevo",
      MINIO_ENDPOINT: "objects.example.com",
      MINIO_SECRET_KEY: "human-secret",
      OTEL_EXPORTER_OTLP_ENDPOINT: "https://telemetry.example.com",
      INTERNAL_API_URL: "https://api.human.example",
      API_BASE_URL: "https://public.human.example",
      API_READINESS_URL: "https://api.human.example/ready",
      SELLER_APPROVAL_RECOVERY_SECRET: "human-seller-recovery-secret",
      PAYMENT_RECOVERY_SECRET: "human-payment-recovery-secret",
    });

    expect(environment).toMatchObject({
      DATABASE_URL:
        "postgresql://sevo:sevo_local@127.0.0.1:55432/sevo_qa_checkout_failure_a1b2c3d4e5f6",
      MINIO_ENDPOINT: "127.0.0.1",
      MINIO_PORT: "59000",
      MINIO_SECRET_KEY: "sevo_local_password",
      OTEL_EXPORTER_OTLP_ENDPOINT: "",
    });
    expect(environment).not.toHaveProperty("INTERNAL_API_URL");
    expect(environment).not.toHaveProperty("API_BASE_URL");
    expect(environment).not.toHaveProperty("API_READINESS_URL");
    expect(environment).not.toHaveProperty("SELLER_APPROVAL_RECOVERY_SECRET");
    expect(environment).not.toHaveProperty("PAYMENT_RECOVERY_SECRET");
    expect(() =>
      assertQaScenarioCallbackEnvironment(environment, target),
    ).not.toThrow();
  });
});
