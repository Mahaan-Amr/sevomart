import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";

import {
  assertNoForbiddenTestMarkers,
  assertReleaseCandidateCoverage,
  assertReleaseCandidateReport,
} from "./qa/release-candidate-report.mjs";

const sha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const migration = readdirSync(resolve("packages/database/prisma/migrations"), {
  withFileTypes: true,
})
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort()
  .at(-1);
const seedVersion = JSON.parse(
  readFileSync(resolve("ops/demo/manifest.v1.json"), "utf8"),
).manifestVersion;
const manifest = JSON.parse(
  readFileSync(resolve("ops/qa/release-evidence-manifest.v1.json"), "utf8"),
);
const outputRoot = resolve("output/release-evidence", sha);
mkdirSync(outputRoot, { recursive: true });
assertNoForbiddenTestMarkers(candidateTestFiles(manifest), (file) =>
  readFileSync(resolve(file), "utf8"),
);

for (const runNumber of [1, 2]) {
  const runId = `candidate-${runNumber}`;
  const environment = {
    ...process.env,
    GITHUB_SHA: sha,
    SEVO_RELEASE_CANDIDATE: "1",
    SEVO_RELEASE_RUN_ID: runId,
  };
  for (const script of ["test:unit", "test:contract", "test:integration"]) {
    const layerResult = runPnpm(script, environment);
    if (layerResult !== 0) process.exit(layerResult);
  }
  const result = spawnSync(
    process.execPath,
    ["scripts/run-e2e-tests.mjs", "--config", "playwright.release.config.ts"],
    { encoding: "utf8", env: environment, stdio: "inherit" },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);

  const reportPath = resolve(outputRoot, runId, "playwright-results.json");
  const reportBytes = readFileSync(reportPath);
  const report = JSON.parse(reportBytes.toString("utf8"));
  assertReleaseCandidateReport(report);
  assertReleaseCandidateCoverage(report, manifest);
  writeFileSync(
    resolve(outputRoot, runId, "receipt.v1.json"),
    `${JSON.stringify(
      {
        contractVersion: 1,
        runId,
        sha,
        migration,
        seedVersion,
        status: "PASSED",
        retries: 0,
        skipped: 0,
        quarantined: 0,
        unexpectedConsoleErrors: 0,
        unexpectedPageErrors: 0,
        unexpectedNetworkErrors: 0,
        cells: receiptCells(manifest),
        report: {
          ref: reportPath,
          sha256: createHash("sha256").update(reportBytes).digest("hex"),
        },
      },
      null,
      2,
    )}\n`,
    { flag: "wx" },
  );
}

function runPnpm(script, environment) {
  const pnpmEntryPoint = process.env.npm_execpath;
  if (!pnpmEntryPoint) throw new Error("pnpm entry point is unavailable");
  const result = spawnSync(process.execPath, [pnpmEntryPoint, script], {
    env: environment,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

function receiptCells(candidateManifest) {
  return candidateManifest.journeys.flatMap((journey) =>
    [
      ...candidateManifest.scenarios.required,
      ...(journey.additionalScenarios ?? []),
    ].map((scenario) => ({
      cellId: `${journey.id}:${scenario}`,
      browsers: journey.browsers,
      viewports: candidateManifest.coverage.viewports,
      testLayers: journey.tests,
    })),
  );
}

function candidateTestFiles(candidateManifest) {
  const files = [
    ...walkTestFiles(resolve("tests/unit"), (file) => file.endsWith(".test.ts")),
    ...walkTestFiles(resolve("apps"), (file) => file.endsWith(".unit.test.ts")),
    ...walkTestFiles(resolve("tests/contract"), (file) => file.endsWith(".test.ts")),
    ...walkTestFiles(resolve("tests/integration"), (file) => file.endsWith(".test.ts")),
    ...candidateManifest.journeys.flatMap((journey) => journey.tests.e2e),
  ];
  return files.map(normalizeRepositoryPath);
}

function walkTestFiles(directory, include) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return walkTestFiles(path, include);
    return include(path) ? [path] : [];
  });
}

function normalizeRepositoryPath(path) {
  return relative(process.cwd(), resolve(path)).replaceAll("\\", "/");
}
