import { expect, it } from "vitest";

import {
  assertNoForbiddenTestMarkers,
  assertReleaseCandidateCoverage,
  assertReleaseCandidateReport,
} from "../../scripts/qa/release-candidate-report.mjs";

it("accepts one-pass candidate results and rejects skip or retry", () => {
  const passed = reportWith([{ status: "passed", retry: 0 }]);
  expect(assertReleaseCandidateReport(passed)).toBe(passed);
  expect(() =>
    assertReleaseCandidateReport(reportWith([{ status: "skipped", retry: 0 }])),
  ).toThrow(/skip, retry or failure/);
  expect(() =>
    assertReleaseCandidateReport(
      reportWith([
        { status: "failed", retry: 0 },
        { status: "passed", retry: 1 },
      ]),
    ),
  ).toThrow(/skip, retry or failure/);
});

it("rejects forbidden markers and missing browser projects", () => {
  const manifest = {
    journeys: [
      {
        browsers: ["chromium", "webkit"],
        tests: {
          unit: ["unit.ts"],
          contract: ["contract.ts"],
          integration: ["integration.ts"],
          e2e: ["tests/e2e/journey.spec.ts"],
        },
      },
    ],
  };
  expect(() =>
    assertNoForbiddenTestMarkers(
      ["tests/unit/unmapped.test.ts", "tests/e2e/journey.spec.ts"],
      (file) =>
        file.includes("unmapped") ? ["test", ".skip('x')"].join("") : "test('x')",
    ),
  ).toThrow(/unmapped.*forbids skip|forbids skip.*unmapped/);
  const report = reportWith([{ status: "passed", retry: 0 }]);
  report.suites[0].specs[0].file = "tests/e2e/journey.spec.ts";
  report.suites[0].specs[0].tests[0].projectName = "chromium-390x844";
  expect(() => assertReleaseCandidateCoverage(report, manifest)).toThrow(
    /did not execute/,
  );
});

function reportWith(results: Array<{ status: string; retry: number }>) {
  return {
    errors: [],
    suites: [
      {
        specs: [
          {
            tests: [
              { title: "candidate test", expectedStatus: results[0]?.status, results },
            ],
          },
        ],
      },
    ],
  };
}
