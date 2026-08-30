import { spawnSync } from "node:child_process";

import { afterAll, describe, expect, it } from "vitest";

const runId = `behavior-${process.pid}`;
let activeTarget:
  | {
      fingerprint: string;
      projectName: string;
    }
  | undefined;

afterAll(() => {
  if (activeTarget) {
    runLifecycle([
      "down",
      "--profile",
      "qa",
      "--run-id",
      runId,
      "--fingerprint",
      activeTarget.fingerprint,
    ]);
  }
});

describe("QA lifecycle CLI", () => {
  it("preserves an owned environment when teardown presents the wrong fingerprint", () => {
    const up = runLifecycle(["up", "--profile", "qa", "--run-id", runId]);
    expect(up.status, up.stderr).toBe(0);
    activeTarget = parseLastJsonLine(up.stdout);

    const refused = runLifecycle([
      "down",
      "--profile",
      "qa",
      "--run-id",
      runId,
      "--fingerprint",
      "00000000-0000-4000-8000-000000000000",
    ]);
    expect(refused.status).not.toBe(0);
    expect(refused.stderr).toContain("teardown refused");

    const running = spawnSync(
      "docker",
      [
        "compose",
        "--project-name",
        activeTarget.projectName,
        "ps",
        "--quiet",
        "--status",
        "running",
      ],
      { encoding: "utf8" },
    );
    expect(running.status, running.stderr).toBe(0);
    expect(running.stdout.trim().split("\n")).toHaveLength(2);

    const removed = runLifecycle([
      "down",
      "--profile",
      "qa",
      "--run-id",
      runId,
      "--fingerprint",
      activeTarget.fingerprint,
    ]);
    expect(removed.status, removed.stderr).toBe(0);
    const releasedOwnership = spawnSync(
      "docker",
      ["volume", "inspect", `${activeTarget.projectName}-owner`],
      { encoding: "utf8" },
    );
    expect(releasedOwnership.status).not.toBe(0);
    activeTarget = undefined;
  }, 60_000);
});

function runLifecycle(argumentsList: string[]) {
  const environment = { ...process.env };
  delete environment.DATABASE_URL;
  return spawnSync(process.execPath, ["scripts/qa/lifecycle.mjs", ...argumentsList], {
    encoding: "utf8",
    env: {
      ...environment,
      OTP_PROVIDER: "dev",
      SEVO_RUNTIME_ENV: "test",
    },
  });
}

function parseLastJsonLine(output: string) {
  const line = output
    .trim()
    .split("\n")
    .findLast((candidate) => candidate.startsWith("{"));
  if (!line) throw new Error("QA lifecycle did not return its target report");
  return JSON.parse(line) as { fingerprint: string; projectName: string };
}
