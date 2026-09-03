import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  createReleaseEvidencePlan,
  finalizeReleaseEvidence,
  validateReleaseEvidenceManifest,
} from "../../scripts/qa/release-evidence.v1.mjs";

const manifest = JSON.parse(
  readFileSync("ops/qa/release-evidence-manifest.v1.json", "utf8"),
);

describe("release evidence plan", () => {
  it("expands every required journey scenario for three spaces and five identities", () => {
    expect(validateReleaseEvidenceManifest(manifest)).toBe(manifest);

    const plan = createReleaseEvidencePlan(
      manifest,
      {
        sha: "a".repeat(40),
        migration: "20260831150000__platform__track-demo-seed-resources",
        seedVersion: 2,
        health: {
          api: candidateArtifact("output/health/api.json"),
          web: candidateArtifact("output/health/web.json"),
          worker: candidateArtifact("output/health/worker.json"),
        },
        startup: {
          docker: candidateArtifact("output/startup/docker.json"),
          native: candidateArtifact("output/startup/native.json"),
        },
        author: "Mahaan-Amr",
      },
      { now: new Date("2026-09-01T08:00:00.000Z") },
    );

    expect(
      new Set(manifest.journeys.map(({ space }: { space: string }) => space)),
    ).toEqual(new Set(["buyer", "seller", "platform"]));
    expect(new Set(manifest.identities.map(({ id }: { id: string }) => id))).toEqual(
      new Set(["buyer", "seller", "applicant", "review-agent", "access-manager"]),
    );
    expect(plan.candidateRuns).toBe(2);
    expect(plan.retentionUntil).toBe("2026-10-01T08:00:00.000Z");
    expect(plan.cells.length).toBeGreaterThan(manifest.journeys.length * 8);
    expect(
      new Set(plan.cells.map((cell: { journeyId: string }) => cell.journeyId)),
    ).toEqual(new Set(manifest.journeys.map(({ id }: { id: string }) => id)));
    expect(plan.cells[0]).not.toHaveProperty("reviewers");
    expect(plan.cells[0]).not.toHaveProperty("runs");
  });

  it("approves only two fresh, independently reviewed, zero-exception runs", () => {
    const plan = createReleaseEvidencePlan(manifest, candidateMetadata(), {
      now: new Date("2026-09-01T08:00:00.000Z"),
    });
    const evidence = {
      ...plan,
      approvals: ["Mahaan-Amr", "ferpheri"],
      runs: [completeRun(plan, 1), completeRun(plan, 2)],
    };

    expect(finalize(evidence)).toMatchObject({
      status: "APPROVED",
      candidate: { sha: "a".repeat(40) },
    });

    const rejected = structuredClone(evidence);
    rejected.runs[0].observations[0].retryCount = 1;
    rejected.runs[0].observations[0].outcome = "RETRIED";
    rejected.runs[0].observations[0].unexpectedConsoleErrors.push("Uncaught TypeError");
    expect(() => finalize(rejected)).toThrow(/forbidden outcome RETRIED/);

    const pageError = structuredClone(evidence);
    pageError.runs[1].observations[0].unexpectedPageErrors.push("Unhandled rejection");
    expect(() => finalize(pageError)).toThrow(/unexpected page error/);

    const incomplete = structuredClone(evidence);
    const removedCell = incomplete.cells.pop();
    for (const run of incomplete.runs) {
      run.observations = run.observations.filter(
        ({ cellId }: { cellId: string }) => cellId !== removedCell.cellId,
      );
    }
    expect(() => finalize(incomplete)).toThrow(/does not match the manifest/);
  });

  it("rejects a manifest that drops a mandatory state", () => {
    const incomplete = structuredClone(manifest);
    incomplete.scenarios.required = ["success"];

    expect(() => validateReleaseEvidenceManifest(incomplete)).toThrow(
      /mandatory scenarios/,
    );
  });

  it("does not count one execution twice under different fingerprints", () => {
    const plan = createReleaseEvidencePlan(manifest, candidateMetadata(), {
      now: new Date("2026-09-01T08:00:00.000Z"),
    });
    const run = completeRun(plan, 1);
    const duplicate = structuredClone(run);
    duplicate.environmentFingerprint = "2".repeat(32);
    expect(() =>
      finalize({
        ...plan,
        approvals: ["Mahaan-Amr", "ferpheri"],
        runs: [run, duplicate],
      }),
    ).toThrow(/unique run/);
  });

  it("treats GitHub login case and surrounding whitespace as the same reviewer", () => {
    const plan = createReleaseEvidencePlan(manifest, candidateMetadata(), {
      now: new Date("2026-09-01T08:00:00.000Z"),
    });
    const runs = [completeRun(plan, 1), completeRun(plan, 2)];
    runs[0].observations[0].reviewer = " mahaan-amr ";
    expect(() =>
      finalize({ ...plan, approvals: ["Mahaan-Amr", "ferpheri"], runs }),
    ).toThrow(/independent reviewer/);
  });

  it("does not count an author's differently-cased login as a second approval", () => {
    const plan = createReleaseEvidencePlan(manifest, candidateMetadata(), {
      now: new Date("2026-09-01T08:00:00.000Z"),
    });
    expect(() =>
      finalize({
        ...plan,
        approvals: ["Mahaan-Amr", " mahaan-amr "],
        runs: [completeRun(plan, 1), completeRun(plan, 2)],
      }),
    ).toThrow(/both developers/);
  });

  it("refuses to approve an evidence pack after its retention window", () => {
    const plan = createReleaseEvidencePlan(manifest, candidateMetadata(), {
      now: new Date("2026-09-01T08:00:00.000Z"),
    });
    expect(() =>
      finalizeReleaseEvidence(
        manifest,
        {
          ...plan,
          approvals: ["Mahaan-Amr", "ferpheri"],
          runs: [completeRun(plan, 1), completeRun(plan, 2)],
        },
        {
          now: new Date("2026-10-01T08:00:00.000Z"),
          verifyArtifact: () => true,
          readReceipt: (artifact) => artifact.content,
        },
      ),
    ).toThrow(/expired/);
  });

  it("checks the underlying browser report digest instead of trusting its receipt", () => {
    const plan = createReleaseEvidencePlan(manifest, candidateMetadata(), {
      now: new Date("2026-09-01T08:00:00.000Z"),
    });
    const runs = [completeRun(plan, 1), completeRun(plan, 2)];
    expect(() =>
      finalizeReleaseEvidence(
        manifest,
        {
          ...plan,
          approvals: ["Mahaan-Amr", "ferpheri"],
          runs,
        },
        {
          now: new Date("2026-09-01T12:00:00.000Z"),
          verifyArtifact: (artifact) =>
            artifact.ref !== "output/1/playwright-results.json",
          readReceipt: (artifact) => artifact.content,
        },
      ),
    ).toThrow(/browser report/);
  });

  it("binds each disposable fingerprint to its execution receipt", () => {
    const plan = createReleaseEvidencePlan(manifest, candidateMetadata(), {
      now: new Date("2026-09-01T08:00:00.000Z"),
    });
    const runs = [completeRun(plan, 1), completeRun(plan, 2)];
    runs[0].environmentFingerprint = "unrelated-fingerprint";
    expect(() =>
      finalize({ ...plan, approvals: ["Mahaan-Amr", "ferpheri"], runs }),
    ).toThrow(/receipt did not pass/);
  });

  it("rechecks the browser report instead of accepting invented receipt cells", () => {
    const plan = createReleaseEvidencePlan(manifest, candidateMetadata(), {
      now: new Date("2026-09-01T08:00:00.000Z"),
    });
    const runs = [completeRun(plan, 1), completeRun(plan, 2)];
    runs[0].receipt.content.report.content.suites = [];
    expect(() =>
      finalize({ ...plan, approvals: ["Mahaan-Amr", "ferpheri"], runs }),
    ).toThrow(/report is empty/);
  });
});

function candidateMetadata() {
  return {
    sha: "a".repeat(40),
    migration: "20260831150000__platform__track-demo-seed-resources",
    seedVersion: 2,
    health: {
      api: candidateArtifact("output/health/api.json"),
      web: candidateArtifact("output/health/web.json"),
      worker: candidateArtifact("output/health/worker.json"),
    },
    startup: {
      docker: candidateArtifact("output/startup/docker.json"),
      native: candidateArtifact("output/startup/native.json"),
    },
    author: "Mahaan-Amr",
  };
}

function candidateArtifact(ref: string) {
  return {
    ref,
    sha256: "c".repeat(64),
    sha: "a".repeat(40),
    migration: "20260831150000__platform__track-demo-seed-resources",
    seedVersion: 2,
  };
}

function completeRun(
  plan: ReturnType<typeof createReleaseEvidencePlan>,
  runNumber: number,
) {
  const receiptContent = {
    contractVersion: 1,
    runId: `candidate-${runNumber}`,
    environmentFingerprint: `${String(runNumber).repeat(32)}`,
    sha: plan.candidate.sha,
    migration: plan.candidate.migration,
    seedVersion: plan.candidate.seedVersion,
    status: "PASSED",
    retries: 0,
    skipped: 0,
    quarantined: 0,
    unexpectedConsoleErrors: 0,
    unexpectedPageErrors: 0,
    unexpectedNetworkErrors: 0,
    report: {
      ref: `output/${runNumber}/playwright-results.json`,
      sha256: "d".repeat(64),
      content: browserReport(plan),
    },
    cells: plan.cells.map((cell) => ({
      cellId: cell.cellId,
      browsers: cell.browsers,
      viewports: cell.viewports,
      testLayers: cell.testLayers,
    })),
  };
  return {
    runId: `candidate-${runNumber}`,
    environmentFingerprint: `${String(runNumber).repeat(32)}`,
    sha: plan.candidate.sha,
    migration: plan.candidate.migration,
    seedVersion: plan.candidate.seedVersion,
    health: plan.candidate.health,
    receipt: {
      ...candidateArtifact(`output/${runNumber}/receipt.v1.json`),
      runId: `candidate-${runNumber}`,
      content: receiptContent,
    },
    observations: plan.cells.map((cell) => ({
      cellId: cell.cellId,
      outcome: "PASSED",
      retryCount: 0,
      unexpectedConsoleErrors: [],
      unexpectedPageErrors: [],
      unexpectedNetworkErrors: [],
      coverage: {
        browsers: [...cell.browsers],
        viewports: [...cell.viewports],
        testLayers: Object.fromEntries(
          Object.keys(cell.testLayers).map((layer) => [
            layer,
            [...cell.testLayers[layer]],
          ]),
        ),
      },
      artifacts: cell.artifactKinds.map((kind) => ({
        kind,
        ref: `output/${runNumber}/${cell.cellId}/${kind}.json`,
        sha256: "b".repeat(64),
        runId: `candidate-${runNumber}`,
        cellId: cell.cellId,
        sha: plan.candidate.sha,
        migration: plan.candidate.migration,
        seedVersion: plan.candidate.seedVersion,
        retentionUntil: plan.retentionUntil,
      })),
      reviewer: "ferpheri",
      reviewedAt: "2026-09-01T10:00:00.000Z",
    })),
  };
}

function finalize(evidence: ReturnType<typeof createReleaseEvidencePlan>) {
  return finalizeReleaseEvidence(manifest, evidence, {
    now: new Date("2026-09-01T12:00:00.000Z"),
    verifyArtifact: () => true,
    readReceipt: (artifact) => artifact.content,
  });
}

function browserReport(plan: ReturnType<typeof createReleaseEvidencePlan>) {
  return {
    suites: [
      {
        specs: plan.cells.flatMap((cell) =>
          cell.testLayers.e2e.map((file) => ({
            file,
            tests: cell.browsers.flatMap((browser) =>
              (browser === "webkit"
                ? [
                    [390, 844],
                    [1440, 900],
                  ]
                : [
                    [360, 800],
                    [390, 844],
                    [768, 1024],
                    [1440, 900],
                  ]
              ).map(([width, height]) => ({
                projectName: `${browser}-${width}x${height}`,
                expectedStatus: "passed",
                results: [{ status: "passed", retry: 0 }],
                annotations: [1, 2].map((zoom) => ({
                  type: "release-cell",
                  description: JSON.stringify({
                    cellId: cell.cellId,
                    browser,
                    width: width / zoom,
                    height: height / zoom,
                    zoom,
                  }),
                })),
              })),
            ),
          })),
        ),
      },
    ],
  };
}
