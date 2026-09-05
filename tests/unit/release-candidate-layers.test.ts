import { expect, it, vi } from "vitest";

import {
  releaseCandidateLayerEnvironment,
  runReleaseCandidateLayers,
} from "../../scripts/qa/release-candidate-layers.mjs";

it("builds workspace packages before running candidate test layers", () => {
  const runScript = vi.fn(() => 0);

  runReleaseCandidateLayers(runScript);

  expect(runScript.mock.calls.map(([script]) => script)).toEqual([
    "build:packages",
    "test:unit",
    "test:contract",
    "test:integration",
  ]);
});

it("stops at the first failed candidate layer", () => {
  const runScript = vi.fn((script: string) => (script === "test:unit" ? 1 : 0));

  expect(() => runReleaseCandidateLayers(runScript)).toThrow("failed test:unit");
  expect(runScript.mock.calls.map(([script]) => script)).toEqual([
    "build:packages",
    "test:unit",
  ]);
});

it("gives the integration runner ownership of its disposable targets", () => {
  const candidateEnvironment = {
    DATABASE_URL: "postgresql://sevo:sevo_local@127.0.0.1:32000/sevo_qa_release",
    MINIO_ENDPOINT: "127.0.0.1",
    MINIO_PORT: "32001",
    OTP_PROVIDER: "dev",
    SEVO_RUNTIME_ENV: "test",
  };

  expect(releaseCandidateLayerEnvironment("test:unit", candidateEnvironment)).toBe(
    candidateEnvironment,
  );
  expect(
    releaseCandidateLayerEnvironment("test:integration", candidateEnvironment),
  ).toMatchObject({
    OTP_PROVIDER: "dev",
    SEVO_RUNTIME_ENV: "test",
  });
  expect(
    releaseCandidateLayerEnvironment("test:integration", candidateEnvironment),
  ).not.toHaveProperty("DATABASE_URL");
  expect(
    releaseCandidateLayerEnvironment("test:integration", candidateEnvironment),
  ).not.toHaveProperty("MINIO_ENDPOINT");
});
