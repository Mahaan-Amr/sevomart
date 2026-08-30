import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  QA_SCENARIO_CONTRACT_VERSION,
  withQaScenario,
} from "../../scripts/qa/scenario.v1.mjs";

describe("versioned isolated QA scenario contract", () => {
  it("publishes one deep v1 interface independent from the demo seed", () => {
    const contract = JSON.parse(
      readFileSync("ops/qa/scenario-contract.v1.json", "utf8"),
    ) as Record<string, unknown>;
    const factorySource = readFileSync("scripts/qa/scenario-factory.v1.mjs", "utf8");

    expect(QA_SCENARIO_CONTRACT_VERSION).toBe(1);
    expect(withQaScenario).toBeTypeOf("function");
    expect(contract).toEqual({
      schemaVersion: 1,
      interface: "withQaScenario",
      namespacePrefix: "sevo.qa.",
      clock: "explicit-fixed-utc",
      lifecycle: "disposable-owned-run",
      processEnvironment: "scrubbed-before-callbacks",
      providers: "internal-only",
      reportChannel: "owned-file-descriptor",
      teardownProof: ["runId", "fingerprint"],
    });
    expect(factorySource).not.toContain("demo/seed");
    expect(factorySource).not.toContain("ops/demo");
  });

  it("runs scenario integration outside the shared database runner", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };
    const sharedConfig = readFileSync("vitest.integration.config.ts", "utf8");
    const isolatedConfig = readFileSync("vitest.qa-scenario.config.ts", "utf8");

    expect(packageJson.scripts["test:integration"]).toContain("pnpm test:qa-scenario");
    expect(packageJson.scripts["test:qa-scenario"]).toBe(
      "node scripts/run-qa-scenario-tests.mjs",
    );
    expect(sharedConfig).toContain(
      'exclude: ["tests/integration/qa-scenario-factory.test.ts"]',
    );
    expect(isolatedConfig).toContain(
      'include: ["tests/integration/qa-scenario-factory.test.ts"]',
    );
    expect(isolatedConfig).not.toContain("integration-test-setup");
  });
});
