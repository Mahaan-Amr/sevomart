import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

const manifest = JSON.parse(
  readFileSync("ops/qa/release-evidence-manifest.v1.json", "utf8"),
);
const contract = JSON.parse(
  readFileSync("ops/qa/release-evidence-contract.v1.json", "utf8"),
);

describe("release evidence v1 contract", () => {
  it("keeps every test trace resolvable and candidate policy versioned", () => {
    expect(contract).toMatchObject({
      schemaVersion: 1,
      manifest: "ops/qa/release-evidence-manifest.v1.json",
      policySource: "manifest.policy",
    });
    expect(manifest.policy).toMatchObject({
      candidateRuns: 2,
      retries: 0,
      retentionDays: 30,
    });

    const traces = manifest.journeys.flatMap(({ tests }: { tests: object }) =>
      Object.values(tests).flat(),
    ) as string[];
    const trackedFiles = new Set(git(["ls-files"]).stdout.trim().split(/\r?\n/));
    expect(traces).not.toHaveLength(0);
    expect(traces.filter((trace) => !existsSync(trace))).toEqual([]);
    expect(traces.filter((trace) => !trackedFiles.has(trace))).toEqual([]);

    const releaseConfig = readFileSync("playwright.release.config.ts", "utf8");
    expect(releaseConfig).toContain("retries: 0");
    expect(releaseConfig).toContain("forbidOnly: true");
    expect(releaseConfig).toContain("channel: undefined");
  });

  it("exposes validate and plan through the package CLI", () => {
    const outputDirectory = mkdtempSync(join(tmpdir(), "sevo-evidence-"));
    const outputPath = join(outputDirectory, "plan.json");
    const artifacts = Object.fromEntries(
      ["api", "web", "worker", "docker", "native"].map((name) => {
        const path = join(outputDirectory, `${name}.json`);
        writeFileSync(path, JSON.stringify({ healthy: true, name }));
        return [name, path];
      }),
    );
    try {
      expect(runCli(["validate"]).status).toBe(0);
      const planned = runCli([
        "plan",
        "--sha",
        currentHead(),
        "--migration",
        "20260901123000__media__purchase-experience-images",
        "--seed-version",
        "2",
        "--health-api",
        artifacts.api,
        "--health-web",
        artifacts.web,
        "--health-worker",
        artifacts.worker,
        "--startup-docker",
        artifacts.docker,
        "--startup-native",
        artifacts.native,
        "--author",
        "Mahaan-Amr",
        "--output",
        outputPath,
      ]);
      expect(planned.status, planned.stderr).toBe(0);
      expect(JSON.parse(readFileSync(outputPath, "utf8"))).toMatchObject({
        contractVersion: 1,
        status: "PENDING",
        candidateRuns: 2,
      });
    } finally {
      rmSync(outputDirectory, { recursive: true, force: true });
    }
  });
});

function runCli(argumentsList: string[]) {
  return spawnSync(
    process.execPath,
    ["scripts/release-evidence.mjs", ...argumentsList],
    {
      encoding: "utf8",
    },
  );
}

function currentHead() {
  const result = git(["rev-parse", "HEAD"]);
  expect(result.status, result.stderr).toBe(0);
  return result.stdout.trim();
}

function git(argumentsList: string[]) {
  return spawnSync("git", argumentsList, { encoding: "utf8" });
}
