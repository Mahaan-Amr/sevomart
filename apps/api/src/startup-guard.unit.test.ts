import { readRuntimeEnvironment } from "@sevo/config";
import { describe, expect, it } from "vitest";

import { createApiApp } from "./create-app";
import { MediaModule } from "./modules/media/media.module";

const productionWithDevOtp = readRuntimeEnvironment({
  NODE_ENV: "production",
  API_PORT: "3001",
  WEB_ORIGIN: "https://sevo.example",
  DATABASE_URL: "postgresql://sevo:secret@database:5432/sevo",
  OTEL_EXPORTER_OTLP_ENDPOINT: "",
  OTP_PROVIDER: "dev",
  DEV_OTP_TEST_MOBILES: "09123456789",
});

describe("API startup guard", () => {
  it("stops startup when DevOtpProvider is selected in production", async () => {
    await expect(createApiApp(productionWithDevOtp)).rejects.toThrow(
      "DevOtpProvider cannot run in production",
    );
  });

  it("refuses process-local media storage in production", () => {
    expect(() => MediaModule.register(productionWithDevOtp)).toThrow(
      "Media storage adapter is not configured for production",
    );
  });
});
