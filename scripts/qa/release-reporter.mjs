import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { relative, resolve, sep } from "node:path";

export default class ReleaseReporter {
  constructor({ outputDir }) {
    this.outputDir = resolve(outputDir);
    this.errors = [];
    this.completed = 0;
  }
  onBegin(_config, suite) {
    this.suite = suite;
  }
  onError() {
    this.errors.push({ message: "Unhandled runner error" });
  }
  onTestEnd(test, result) {
    this.completed += 1;
    const file = relative(process.cwd(), test.location.file).replaceAll("\\", "/");
    process.stdout.write(
      `${this.completed}/${this.suite.allTests().length} ${test.parent.project().name} ${file}:${test.location.line} ${result.status}\n`,
    );
  }
  printsToStdio() {
    return true;
  }
  async onEnd(result) {
    mkdirSync(this.outputDir, { recursive: true });
    if (result.status !== "passed")
      this.errors.push({ message: "Release run did not pass" });
    const specs = (this.suite?.allTests() ?? []).map((test) => ({
      file: relative(process.cwd(), test.location.file).replaceAll("\\", "/"),
      line: test.location.line,
      tests: [
        {
          projectName: test.parent.project().name,
          expectedStatus: test.expectedStatus,
          annotations: test.annotations
            .filter((annotation) => annotation.type === "release-cell")
            .map((annotation) => {
              try {
                return {
                  type: "release-cell",
                  description: JSON.stringify(
                    measurement(JSON.parse(annotation.description)),
                  ),
                };
              } catch {
                this.errors.push({ message: "Invalid checkpoint measurement" });
                return { type: "invalid-measurement" };
              }
            }),
          results: test.results.map((run) => ({
            status: run.status,
            retry: run.retry,
            duration: run.duration,
            errors: (run.errors ?? []).map((error) => ({
              location: sourceLocation(error.location),
            })),
            browserActivity: this.browserActivity(run.attachments),
            attachments: this.selectedAttachments(run.attachments),
          })),
        },
      ],
    }));
    const report = { errors: this.errors, suites: [{ specs }] };
    writeFileSync(
      resolve(this.outputDir, "playwright-results.json"),
      `${JSON.stringify(report)}\n`,
    );
    process.stdout.write(
      `Release report: ${specs.length} tests; ${this.errors.length} reporting/run errors\n`,
    );
    return this.errors.length ? { status: "failed" } : undefined;
  }

  browserActivity(attachments) {
    const guard = attachments.find(
      (attachment) => attachment.name === "release-candidate-guard",
    );
    if (!guard?.body) return null;
    try {
      const raw = JSON.parse(guard.body.toString("utf8"));
      const counts = Object.fromEntries(
        ["consoleErrors", "pageErrors", "networkErrors", "externalRequests"].map(
          (key) => {
            if (!Array.isArray(raw[key])) throw new Error("Invalid browser guard");
            return [key, raw[key].length];
          },
        ),
      );
      if (Object.values(counts).some((count) => count > 0))
        this.errors.push({ message: "Unexpected browser activity" });
      return counts;
    } catch {
      this.errors.push({ message: "Invalid browser guard summary" });
      return null;
    }
  }

  selectedAttachments(attachments) {
    const selected = [];
    for (const attachment of attachments) {
      // The framework may write DOM/error snapshots even with trace/video disabled.
      // Both the supplied path and its real target must stay inside the owned run.
      if (attachment.path && existsSync(attachment.path)) {
        try {
          const suppliedPath = resolve(attachment.path);
          if (!suppliedPath.startsWith(`${this.outputDir}${sep}`))
            throw new Error("Outside owned output");
          const file = realpathSync(suppliedPath);
          const root = realpathSync(this.outputDir);
          if (!file.startsWith(`${root}${sep}`))
            throw new Error("Outside owned output");
          unlinkSync(suppliedPath);
        } catch {
          this.errors.push({ message: "Raw attachment cleanup failed" });
        }
      }
      if (
        !/^[a-z0-9-]+-[12]x-accessibility-report$/.test(attachment.name) ||
        !attachment.body
      )
        continue;
      try {
        const raw = JSON.parse(attachment.body.toString("utf8"));
        const name = attachment.name.replace(/-accessibility-report$/, "");
        const screenshot = attachments.find(
          (item) => item.name === `${name}-selected-screenshot`,
        );
        if (!screenshot?.body || screenshot.contentType !== "image/png")
          throw new Error("Missing selected screenshot");
        const digest = createHash("sha256").update(screenshot.body).digest("hex");
        if (digest !== raw.screenshotSha256) throw new Error("Image mismatch");
        const summary = {
          schemaVersion: 1,
          status: "PENDING_INDEPENDENT_REVIEW",
          sha: raw.sha === null ? null : token(raw.sha, /^[0-9a-f]{40}$/),
          runId: raw.runId === null ? null : token(raw.runId, /^[a-z][a-z0-9-]*$/),
          measurement: measurement(raw.measurement),
          geometry: {
            width: positive(raw.geometry.width),
            scrollWidth: positive(raw.geometry.scrollWidth),
            reducedMotion: raw.geometry.reducedMotion === true,
          },
          screenshotSha256: digest,
          engine: {
            name: token(raw.engine.name, /^[a-z-]+$/),
            version: token(raw.engine.version, /^\d+\.\d+\.\d+$/),
          },
          browserVersion:
            raw.browserVersion === null
              ? null
              : token(raw.browserVersion, /^\d+(?:\.\d+){1,3}$/),
          violations: findings(raw.violations),
          incomplete: findings(raw.incomplete),
          manualReview: {
            keyboard: "PENDING",
            longText: "PENDING",
            motion: "PENDING",
            baseline: "PENDING",
          },
        };
        selected.push({
          name: screenshot.name,
          contentType: "image/png",
          body: screenshot.body.toString("base64"),
        });
        selected.push({
          name: attachment.name,
          contentType: "application/json",
          body: Buffer.from(JSON.stringify(summary)).toString("base64"),
        });
      } catch {
        this.errors.push({ message: "Invalid selected checkpoint attachment" });
      }
    }
    return selected;
  }
}

function sourceLocation(location) {
  if (!location?.file) return undefined;
  const file = relative(process.cwd(), location.file).replaceAll("\\", "/");
  if (!/^(tests|apps|packages|scripts)\//.test(file)) return undefined;
  return { file, line: location.line, column: location.column };
}

function token(value, pattern) {
  if (typeof value !== "string" || !pattern.test(value))
    throw new Error("Invalid summary token");
  return value;
}
function positive(value) {
  if (!Number.isInteger(value) || value < 1)
    throw new Error("Invalid measurement number");
  return value;
}
function measurement(value) {
  if (![1, 2].includes(value.zoom)) throw new Error("Invalid zoom");
  if (!["chromium", "webkit"].includes(value.browser))
    throw new Error("Invalid browser engine");
  return {
    cellId: token(value.cellId, /^[a-z0-9-]+:[a-z0-9-]+$/),
    browser: value.browser,
    width: positive(value.width),
    height: positive(value.height),
    zoom: value.zoom,
  };
}
function findings(values) {
  if (!Array.isArray(values)) throw new Error("Invalid findings");
  return values.map((value) => {
    if (![null, "minor", "moderate", "serious", "critical"].includes(value.impact))
      throw new Error("Invalid impact");
    return {
      rule: token(value.rule, /^[a-z][a-z0-9-]+$/),
      impact: value.impact,
      count: positive(value.count),
    };
  });
}
