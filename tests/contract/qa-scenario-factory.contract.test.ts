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
      providers: "internal-only",
      teardownProof: ["runId", "fingerprint"],
    });
    expect(factorySource).not.toContain("demo/seed");
    expect(factorySource).not.toContain("ops/demo");
  });
});
