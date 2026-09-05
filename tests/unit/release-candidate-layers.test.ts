import { expect, it, vi } from "vitest";

import { runReleaseCandidateLayers } from "../../scripts/qa/release-candidate-layers.mjs";

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
