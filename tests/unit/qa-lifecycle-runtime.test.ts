import { describe, expect, it, vi } from "vitest";

import {
  assertQaProjectIsAbsent,
  createQaLifecycleRequest,
  publishQaTargetReport,
} from "../../scripts/qa/runtime.mjs";

const fingerprint = "8e2cd400-e2d7-4ff8-b390-cb265d3eaf9b";
const safeEnvironment = {
  SEVO_RUNTIME_ENV: "test",
  OTP_PROVIDER: "dev",
};

describe("QA environment lifecycle", () => {
  it("refuses a reused run id before startup can own or remove its resources", () => {
    expect(() =>
      assertQaProjectIsAbsent({ containers: [], networks: [], volumes: [] }),
    ).not.toThrow();

    expect(() =>
      assertQaProjectIsAbsent({
        containers: [],
        networks: [],
        volumes: ["sevomart-qa-issue-126_postgres-data"],
      }),
    ).toThrow("already owns Docker resources");
  });

  it("derives an isolated project and database from the explicit run id", () => {
    expect(
      createQaLifecycleRequest(
        ["up", "--profile", "qa", "--run-id", "issue-126"],
        safeEnvironment,
      ),
    ).toEqual({
      action: "up",
      databaseName: "sevo_qa_issue_126",
      profile: "qa",
      projectName: "sevomart-qa-issue-126",
      runId: "issue-126",
    });
  });

  it("requires the target fingerprint before teardown", () => {
    expect(() =>
      createQaLifecycleRequest(
        ["down", "--profile", "qa", "--run-id", "issue-126"],
        safeEnvironment,
      ),
    ).toThrow("fingerprint");

    expect(
      createQaLifecycleRequest(
        [
          "down",
          "--profile",
          "qa",
          "--run-id",
          "issue-126",
          "--fingerprint",
          fingerprint,
        ],
        safeEnvironment,
      ),
    ).toMatchObject({ action: "down", fingerprint });
  });

  it("keeps factory reports off stdout and uses stdout only for CLI mode", () => {
    const report = { profile: "qa", runId: "issue-126" };
    const writeReport = vi.fn();
    const writeStdout = vi.fn();

    publishQaTargetReport(report, {
      environment: { SEVO_QA_REPORT_FD: "3" },
      writeReport,
      writeStdout,
    });
    expect(writeReport).toHaveBeenCalledExactlyOnceWith(
      3,
      `${JSON.stringify(report)}\n`,
    );
    expect(writeStdout).not.toHaveBeenCalled();

    writeReport.mockClear();
    publishQaTargetReport(report, {
      environment: {},
      writeReport,
      writeStdout,
    });
    expect(writeReport).not.toHaveBeenCalled();
    expect(writeStdout).toHaveBeenCalledExactlyOnceWith(`${JSON.stringify(report)}\n`);
  });

  it.each([
    {
      name: "an inherited database URL",
      environment: { ...safeEnvironment, DATABASE_URL: "postgresql://human/sevo" },
      message: "DATABASE_URL",
    },
    {
      name: "a non-test runtime",
      environment: { ...safeEnvironment, SEVO_RUNTIME_ENV: "production" },
      message: "SEVO_RUNTIME_ENV=test",
    },
    {
      name: "an external OTP provider",
      environment: { ...safeEnvironment, OTP_PROVIDER: "external" },
      message: "provider",
    },
  ])("rejects $name before infrastructure startup", (scenario) => {
    expect(() =>
      createQaLifecycleRequest(
        ["up", "--profile", "qa", "--run-id", "issue-126"],
        scenario.environment,
      ),
    ).toThrow(scenario.message);
  });
});
