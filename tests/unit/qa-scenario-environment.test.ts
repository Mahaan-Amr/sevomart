import { describe, expect, it } from "vitest";

import {
  assertQaScenarioProcessEnvironment,
  createQaScenarioProcessEnvironment,
} from "../../scripts/qa/scenario-environment.mjs";

describe("QA scenario process environment", () => {
  it("removes inherited database targets and forces internal providers", () => {
    const environment = createQaScenarioProcessEnvironment({
      DATABASE_URL: "postgresql://human-data.example/sevo",
      OTP_PROVIDER: "external",
      SEVO_RUNTIME_ENV: "production",
    });

    expect(environment).toMatchObject({
      OTP_PROVIDER: "dev",
      SEVO_RUNTIME_ENV: "test",
    });
    expect(environment).not.toHaveProperty("DATABASE_URL");
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
});
