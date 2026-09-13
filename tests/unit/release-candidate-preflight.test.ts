import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { writeFileSync, unlinkSync } from "node:fs";
import { expect, it } from "vitest";
import { createQaScenarioProcessEnvironment } from "../../scripts/qa/scenario-environment.mjs";

it("rejects an inherited database before starting any candidate command", () => {
  const environment = {
    ...process.env,
    DATABASE_URL: "postgresql://invalid.invalid/forbidden",
  };
  delete environment.npm_execpath;
  const result = spawnSync(
    process.execPath,
    ["scripts/run-release-evidence-candidate.mjs"],
    {
      env: environment,
      encoding: "utf8",
      timeout: 10_000,
    },
  );
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("reject inherited DATABASE_URL");
  expect(result.stdout).toBe("");
});

it("refuses to label untracked source as the checked-out commit", () => {
  const marker = `candidate-source-${randomUUID()}.txt`;
  writeFileSync(marker, "uncommitted candidate source", { flag: "wx" });
  try {
    const environment = createQaScenarioProcessEnvironment(process.env);
    delete environment.DATABASE_URL;
    delete environment.npm_execpath;
    const result = spawnSync(
      process.execPath,
      ["scripts/run-release-evidence-candidate.mjs"],
      {
        env: environment,
        encoding: "utf8",
        timeout: 10_000,
      },
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("clean working tree");
    expect(result.stdout).toBe("");
  } finally {
    unlinkSync(marker);
  }
}, 20_000);
