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
  assertReleaseCandidateReport(report);
  const tests = collectTests(report.suites ?? []);
  const executed = new Set(
    tests.map((test) => `${test.projectName}:${normalizePath(test.file)}`),
  );
  const cells = [];
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
    for (const scenario of [
      ...manifest.scenarios.required,
      ...(journey.additionalScenarios ?? []),
    ]) {
      const cellId = `${journey.id}:${scenario}`;
      const measurements = [];
      for (const test of tests) {
        if (!journey.tests.e2e.map(normalizePath).includes(normalizePath(test.file)))
          continue;
        for (const annotation of test.annotations ?? []) {
          if (annotation.type !== "release-cell") continue;
          const measurement = JSON.parse(annotation.description);
          if (measurement.cellId !== cellId) continue;
          const project = /^(chromium|webkit)-(\d+)x(\d+)$/.exec(test.projectName);
          const zoom = measurement.zoom;
          if (
            !project ||
            ![1, 2].includes(zoom) ||
            measurement.width !== Math.floor(Number(project[2]) / zoom) ||
            measurement.height !== Math.floor(Number(project[3]) / zoom)
          ) {
            throw new Error(`Invalid measured viewport for ${cellId}`);
          }
          measurements.push({
            browser: project[1],
            viewport:
              zoom === 2 ? "zoom-200" : `${measurement.width}x${measurement.height}`,
            file: normalizePath(test.file),
            project: test.projectName,
            zoom,
          });
        }
      }
      const browsers = [...new Set(measurements.map((item) => item.browser))];
      const viewports = [...new Set(measurements.map((item) => item.viewport))];
      if (
        !requiredProjects.every((project) =>
          measurements.some((item) => item.project === project && item.zoom === 1),
        ) ||
        !manifest.coverage.viewports.every((viewport) => viewports.includes(viewport))
      ) {
        throw new Error(
          `Release candidate has no complete measured evidence for ${cellId}`,
        );
      }
      cells.push({
        cellId,
        browsers,
        viewports,
        testLayers: {
          ...journey.tests,
          e2e: [...new Set(measurements.map((item) => item.file))],
        },
      });
    }
  }
  return cells;
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
