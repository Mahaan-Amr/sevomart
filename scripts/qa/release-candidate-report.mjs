export function assertReleaseCandidateReport(report) {
  const tests = collectTests(report.suites ?? []);
  if (report.errors?.length || tests.length === 0) {
    throw new Error("Release candidate report is empty or contains top-level errors");
  }
  for (const candidate of tests) {
    if (
      candidate.status === "skipped" ||
      candidate.expectedStatus === "skipped" ||
      candidate.results?.length !== 1 ||
      candidate.results[0]?.status !== "passed" ||
      candidate.results[0]?.retry > 0
    ) {
      throw new Error(
        `Release candidate contains skip, retry or failure: ${candidate.title}`,
      );
    }
  }
  return report;
}

export function assertReleaseCandidateCoverage(report, manifest) {
  const executed = new Set(
    collectTests(report.suites ?? []).map(
      (test) => `${test.projectName}:${normalizePath(test.file)}`,
    ),
  );
  for (const journey of manifest.journeys) {
    const file = normalizePath(journey.tests.e2e[0]);
    const requiredProjects = journey.browsers.flatMap((browser) =>
      browser === "webkit"
        ? ["webkit-390x844", "webkit-1440x900"]
        : [
            "chromium-360x800",
            "chromium-390x844",
            "chromium-768x1024",
            "chromium-1440x900",
          ],
    );
    for (const project of requiredProjects) {
      if (!executed.has(`${project}:${file}`)) {
        throw new Error(`Release candidate did not execute ${file} in ${project}`);
      }
    }
  }
  return executed;
}

export function assertNoForbiddenTestMarkers(files, readTestFile) {
  const forbidden =
    /\b(?:it|test|describe)\s*\.\s*(?:skip|skipIf|runIf|todo|fixme|fails|quarantine|quarantined)\b/i;
  for (const file of new Set(files)) {
    if (forbidden.test(readTestFile(file))) {
      throw new Error(`Release candidate forbids skip, todo and quarantine in ${file}`);
    }
  }
}

function collectTests(suites) {
  return suites.flatMap((suite) => [
    ...(suite.specs ?? []).flatMap((spec) =>
      (spec.tests ?? []).map((test) => ({ ...test, file: spec.file ?? test.file })),
    ),
    ...collectTests(suite.suites ?? []),
  ]);
}

function normalizePath(path) {
  return path?.replaceAll("\\", "/").replace(/^.*?tests\//, "tests/");
}
