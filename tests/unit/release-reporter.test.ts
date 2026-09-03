import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import ReleaseReporter from "../../scripts/qa/release-reporter.mjs";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) {
    if (!resolve(root).startsWith(resolve(tmpdir(), "sevo-release-reporter-")))
      throw new Error("Unexpected cleanup target");
    rmSync(root, { recursive: true });
  }
});
function fixture() {
  const root = mkdtempSync(resolve(tmpdir(), "sevo-release-reporter-"));
  roots.push(root);
  const outputDir = resolve(root, "run");
  mkdirSync(outputDir);
  const test = {
    location: {
      file: resolve("tests/e2e/guest-cart-login.spec.ts"),
      line: 19,
      column: 1,
    },
    parent: { project: () => ({ name: "chromium-390x844" }) },
    title: "private-value-must-not-leak",
    expectedStatus: "passed",
    annotations: [{ type: "note", description: "private-value-must-not-leak" }],
    results: [
      {
        status: "failed",
        retry: 0,
        duration: 10,
        errors: [{ message: "private-value-must-not-leak" }],
        stdout: ["private-value-must-not-leak"],
        attachments: [] as Array<{
          name: string;
          path?: string;
          body?: Buffer;
          contentType: string;
        }>,
      },
    ],
  };
  const reporter = new ReleaseReporter({ outputDir });
  reporter.onBegin({}, { allTests: () => [test] });
  return { root, outputDir, test, reporter };
}

it("omits raw text and removes only run-owned raw attachments while retaining failures", async () => {
  const { outputDir, test, reporter } = fixture();
  const raw = resolve(outputDir, "error-context.md");
  writeFileSync(raw, "private-value-must-not-leak");
  test.results[0]!.attachments.push({
    name: "error-context",
    path: raw,
    contentType: "text/markdown",
  });
  test.results[0]!.attachments.push({
    name: "release-candidate-guard",
    contentType: "application/json",
    body: Buffer.from(
      JSON.stringify({
        consoleErrors: ["private-value-must-not-leak"],
        pageErrors: [],
        networkErrors: [],
        externalRequests: [],
      }),
    ),
  });
  await reporter.onEnd({ status: "failed" });
  const bytes = readFileSync(resolve(outputDir, "playwright-results.json"), "utf8");
  expect(bytes).not.toContain("private-value-must-not-leak");
  expect(existsSync(raw)).toBe(false);
  const report = JSON.parse(bytes);
  expect(
    report.suites[0].specs[0].tests[0].results[0].browserActivity.consoleErrors,
  ).toBe(1);
  expect(report.suites[0].specs[0].tests[0].results[0]).toMatchObject({
    status: "failed",
    retry: 0,
  });
  expect(report.errors).not.toHaveLength(0);
});

it("rejects an attachment outside the owned run without deleting it", async () => {
  const { root, outputDir, test, reporter } = fixture();
  const external = resolve(root, "keep.txt");
  writeFileSync(external, "keep");
  test.results[0]!.attachments.push({
    name: "error-context",
    path: external,
    contentType: "text/markdown",
  });
  await expect(reporter.onEnd({ status: "passed" })).resolves.toEqual({
    status: "failed",
  });
  expect(readFileSync(external, "utf8")).toBe("keep");
  expect(
    JSON.parse(readFileSync(resolve(outputDir, "playwright-results.json"), "utf8"))
      .errors,
  ).not.toHaveLength(0);
});

it("rejects an outside alias into the owned run without deleting its target", async () => {
  const { root, outputDir, test, reporter } = fixture();
  const raw = resolve(outputDir, "keep.txt");
  writeFileSync(raw, "keep");
  const alias = resolve(root, "outside-alias");
  symlinkSync(outputDir, alias, "junction");
  test.results[0]!.attachments.push({
    name: "error-context",
    path: resolve(alias, "keep.txt"),
    contentType: "text/plain",
  });
  await expect(reporter.onEnd({ status: "passed" })).resolves.toEqual({
    status: "failed",
  });
  expect(readFileSync(raw, "utf8")).toBe("keep");
});

it("keeps unexecuted tests in the report instead of silently dropping them", async () => {
  const { outputDir, test, reporter } = fixture();
  test.results = [];
  await reporter.onEnd({ status: "interrupted" });
  const report = JSON.parse(
    readFileSync(resolve(outputDir, "playwright-results.json"), "utf8"),
  );
  expect(report.suites[0].specs[0].tests[0].results).toEqual([]);
  expect(report.errors).not.toHaveLength(0);
});

it("rejects an executed release test without a browser guard summary", async () => {
  const { reporter } = fixture();
  await expect(reporter.onEnd({ status: "passed" })).resolves.toEqual({
    status: "failed",
  });
  expect(reporter.errors).toContainEqual({ message: "Missing browser guard summary" });
});

it("retains a digest-bound selected image and whitelists its summary fields", async () => {
  const { outputDir, test, reporter } = fixture();
  const screenshot = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1cAAAAASUVORK5CYII=",
    "base64",
  );
  const summary = {
    sha: null,
    runId: "diagnostic",
    measurement: {
      cellId: "buyer-sign-in:empty",
      browser: "chromium",
      width: 390,
      height: 844,
      zoom: 1,
    },
    geometry: {
      width: 390,
      scrollWidth: 390,
      reducedMotion: true,
      dom: "private-value-must-not-leak",
    },
    screenshotSha256: createHash("sha256").update(screenshot).digest("hex"),
    engine: { name: "axe-core", version: "4.13.0" },
    browserVersion: "142.0.1.1",
    violations: [],
    incomplete: [],
    rawHtml: "private-value-must-not-leak",
    manualReview: { baseline: "APPROVED" },
  };
  test.results[0]!.status = "passed";
  test.results[0]!.attachments.push(
    {
      name: "release-candidate-guard",
      contentType: "application/json",
      body: Buffer.from(
        JSON.stringify({
          consoleErrors: [],
          pageErrors: [],
          networkErrors: [],
          externalRequests: [],
        }),
      ),
    },
    {
      name: "login-1x-selected-screenshot",
      contentType: "image/png",
      body: screenshot,
    },
    {
      name: "login-1x-accessibility-report",
      contentType: "application/json",
      body: Buffer.from(JSON.stringify(summary)),
    },
  );
  await reporter.onEnd({ status: "passed" });
  const report = JSON.parse(
    readFileSync(resolve(outputDir, "playwright-results.json"), "utf8"),
  );
  const attachments = report.suites[0].specs[0].tests[0].results[0].attachments;
  expect(report.errors).toEqual([]);
  expect(Buffer.from(attachments[0].body, "base64")).toEqual(screenshot);
  const sanitized = Buffer.from(attachments[1].body, "base64").toString("utf8");
  expect(sanitized).not.toContain("private-value-must-not-leak");
  expect(JSON.parse(sanitized).manualReview.baseline).toBe("PENDING");

  summary.screenshotSha256 = "0".repeat(64);
  test.results[0]!.attachments[1]!.body = Buffer.from(JSON.stringify(summary));
  await expect(reporter.onEnd({ status: "passed" })).resolves.toEqual({
    status: "failed",
  });
  const rejected = JSON.parse(
    readFileSync(resolve(outputDir, "playwright-results.json"), "utf8"),
  );
  expect(rejected.suites[0].specs[0].tests[0].results[0].attachments).toEqual([]);
});
