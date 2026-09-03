import { readFileSync } from "node:fs";

import { expect, it } from "vitest";
import config from "../../playwright.release.config";
import manifest from "../../ops/qa/release-evidence-manifest.v1.json";

it("runs WebKit smoke with the WebKit engine instead of the inherited Chromium default", () => {
  const projects = config.projects!.filter((project) =>
    project.name?.startsWith("webkit-"),
  );
  expect(projects).toHaveLength(2);
  for (const project of projects) {
    expect(project.use?.browserName ?? config.use?.browserName).toBe("webkit");
    expect(project.use?.channel ?? config.use?.channel).toBeUndefined();
  }
});

it("runs only manifest journeys in Chromium candidate projects", () => {
  const project = config.projects!.find((candidate) =>
    candidate.name?.startsWith("chromium-"),
  );
  expect(project).toBeDefined();
  const patterns = Array.isArray(project!.testMatch) ? project!.testMatch : [project!.testMatch];
  const required = new Set(manifest.journeys.flatMap((journey) => journey.tests.e2e));
  for (const file of required) {
    expect(patterns.some((pattern) => pattern instanceof RegExp && pattern.test(file))).toBe(true);
  }
  expect(patterns.some((pattern) => pattern instanceof RegExp && pattern.test("tests/e2e/web-baseline.spec.ts"))).toBe(false);
});

it("requires manifest tests to create extra browser contexts through the guard", () => {
  const required = new Set(manifest.journeys.flatMap((journey) => journey.tests.e2e));
  for (const file of required) {
    expect(readFileSync(file, "utf8"), file).not.toMatch(/browser\.newContext\s*\(/);
  }
});
