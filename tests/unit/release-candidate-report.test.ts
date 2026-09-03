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

it("does not infer scenario or zoom evidence from a passing file in every project", () => {
  const manifest = {
    scenarios: { required: ["success", "recovery"] },
    coverage: { viewports: ["360x800", "390x844", "768x1024", "1440x900", "zoom-200"] },
    journeys: [
      {
        id: "buyer-sign-in",
        browsers: ["chromium"],
        tests: { e2e: ["tests/e2e/login.spec.ts"] },
      },
    ],
  };
  const report = {
    suites: [
      {
        specs: [
          {
            file: "tests/e2e/login.spec.ts",
            tests: ["360x800", "390x844", "768x1024", "1440x900"].map((viewport) => ({
              projectName: `chromium-${viewport}`,
              expectedStatus: "passed",
              results: [{ status: "passed", retry: 0 }],
            })),
          },
        ],
      },
    ],
  };
  expect(() => assertReleaseCandidateCoverage(report, manifest)).toThrow(
    /measured evidence/,
  );
});

it("receipts only explicit successful scenario measurements and rejects a mislabeled viewport", () => {
  const manifest = {
    scenarios: { required: ["success"] },
    coverage: { viewports: ["360x800", "390x844", "768x1024", "1440x900", "zoom-200"] },
    journeys: [
      {
        id: "buyer-sign-in",
        browsers: ["chromium"],
        tests: { e2e: ["tests/e2e/login.spec.ts"] },
      },
    ],
  };
  const tests = [
    { width: 360, height: 800 },
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1440, height: 900 },
  ].map(({ width, height }) => ({
    projectName: `chromium-${width}x${height}`,
    expectedStatus: "passed",
    results: [{ status: "passed", retry: 0 }],
    annotations: [1, 2].map((zoom) => ({
      type: "release-cell",
      description: JSON.stringify({
        cellId: "buyer-sign-in:success",
        browser: "chromium",
        width: width / zoom,
        height: height / zoom,
        zoom,
      }),
    })),
  }));
  const report = { suites: [{ specs: [{ file: "tests/e2e/login.spec.ts", tests }] }] };
  expect(assertReleaseCandidateCoverage(report, manifest)).toEqual([
    {
      cellId: "buyer-sign-in:success",
      browsers: ["chromium"],
      viewports: ["360x800", "zoom-200", "390x844", "768x1024", "1440x900"],
      testLayers: { e2e: ["tests/e2e/login.spec.ts"] },
    },
  ]);
  tests[3].annotations[0].description = JSON.stringify({
    cellId: "buyer-sign-in:success",
    browser: "chromium",
    width: 390,
    height: 844,
    zoom: 1,
  });
  expect(() => assertReleaseCandidateCoverage(report, manifest)).toThrow(
    /Invalid measured viewport/,
  );
  tests[3].annotations[0].description = JSON.stringify({
    cellId: "buyer-sign-in:success",
    browser: "webkit",
    width: 1440,
    height: 900,
    zoom: 1,
  });
  expect(() => assertReleaseCandidateCoverage(report, manifest)).toThrow(
    /Invalid measured viewport/,
  );
});
