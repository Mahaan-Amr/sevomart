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
    ).toThrow("Production trust requires external OTP and non-default secrets");
  });
});
