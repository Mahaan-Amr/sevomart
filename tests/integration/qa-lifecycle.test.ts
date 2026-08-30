import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";

import { QA_PROJECT_CLEANUP_EVENT } from "../../scripts/qa/runtime.mjs";

type QaTarget = { fingerprint: string; projectName: string };
type QaFixture = { activeTarget?: QaTarget; runId: string };

const uniqueRunId = (prefix: string) =>
  `${prefix}-${randomUUID().replaceAll("-", "").slice(0, 20)}`;
const guardedFixture: QaFixture = { runId: uniqueRunId("behavior") };
const raceFixture: QaFixture = { runId: uniqueRunId("race") };

afterAll(() => {
  for (const fixture of [guardedFixture, raceFixture]) {
    if (fixture.activeTarget) {
      runLifecycle([
        "down",
        "--profile",
        "qa",
        "--run-id",
        fixture.runId,
        "--fingerprint",
        fixture.activeTarget.fingerprint,
      ]);
    }
  }
});

describe("QA lifecycle CLI", () => {
  it("preserves an owned environment when teardown presents the wrong fingerprint", () => {
    const up = runLifecycle([
      "up",
      "--profile",
      "qa",
      "--run-id",
      guardedFixture.runId,
    ]);
    expect(up.status, up.stderr).toBe(0);
    guardedFixture.activeTarget = parseLastJsonLine(up.stdout);

    const refused = runLifecycle([
      "down",
      "--profile",
      "qa",
      "--run-id",
      guardedFixture.runId,
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
        guardedFixture.activeTarget.projectName,
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
      guardedFixture.runId,
      "--fingerprint",
      guardedFixture.activeTarget.fingerprint,
    ]);
    expect(removed.status, removed.stderr).toBe(0);
    const releasedOwnership = spawnSync(
      "docker",
      ["volume", "inspect", `${guardedFixture.activeTarget.projectName}-owner`],
      { encoding: "utf8" },
    );
    expect(releasedOwnership.status).not.toBe(0);
    guardedFixture.activeTarget = undefined;
  }, 60_000);

  it("allows only one real concurrent qa:up process to own and clean a run", async () => {
    const contenders = await Promise.all([
      runLifecycleAsync(["up", "--profile", "qa", "--run-id", raceFixture.runId]),
      runLifecycleAsync(["up", "--profile", "qa", "--run-id", raceFixture.runId]),
    ]);
    const winners = contenders.filter(({ status }) => status === 0);
    const losers = contenders.filter(({ status }) => status !== 0);

    expect(winners, contenders.map(formatLifecycleResult).join("\n")).toHaveLength(1);
    expect(losers, contenders.map(formatLifecycleResult).join("\n")).toHaveLength(1);
    expect(losers[0]?.stderr).toContain("already owned");
    expect(cleanupEvents(losers[0]?.stderr ?? "")).toEqual([]);

    raceFixture.activeTarget = parseLastJsonLine(winners[0]?.stdout ?? "");
    const running = docker([
      "compose",
      "--project-name",
      raceFixture.activeTarget.projectName,
      "ps",
      "--quiet",
      "--status",
      "running",
    ]);
    expect(running.status, running.stderr).toBe(0);
    expect(running.stdout.trim().split("\n")).toHaveLength(2);

    const ownershipToken = docker([
      "volume",
      "inspect",
      "--format",
      '{{ index .Labels "sevo.qa.owner-token" }}',
      `${raceFixture.activeTarget.projectName}-owner`,
    ]);
    expect(ownershipToken.status, ownershipToken.stderr).toBe(0);
    expect(ownershipToken.stdout.trim()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );

    const removed = runLifecycle([
      "down",
      "--profile",
      "qa",
      "--run-id",
      raceFixture.runId,
      "--fingerprint",
      raceFixture.activeTarget.fingerprint,
    ]);
    expect(removed.status, removed.stderr).toBe(0);
    expect(cleanupEvents(removed.stderr)).toEqual([
      {
        event: QA_PROJECT_CLEANUP_EVENT,
        projectName: raceFixture.activeTarget.projectName,
      },
    ]);
    expect(projectResources(raceFixture.activeTarget.projectName)).toEqual({
      containers: [],
      networks: [],
      volumes: [],
    });
    const releasedOwnership = docker([
      "volume",
      "inspect",
      `${raceFixture.activeTarget.projectName}-owner`,
    ]);
    expect(releasedOwnership.status).not.toBe(0);
    raceFixture.activeTarget = undefined;
  }, 120_000);
});

function runLifecycle(argumentsList: string[]) {
  return spawnSync(process.execPath, ["scripts/qa/lifecycle.mjs", ...argumentsList], {
    encoding: "utf8",
    env: lifecycleEnvironment(),
  });
}

function runLifecycleAsync(argumentsList: string[]) {
  return new Promise<{ status: number | null; stderr: string; stdout: string }>(
    (resolve, reject) => {
      const child = spawn(
        process.execPath,
        ["scripts/qa/lifecycle.mjs", ...argumentsList],
        {
          env: lifecycleEnvironment(),
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      let stdout = "";
      let stderr = "";
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk: string) => {
        stderr += chunk;
      });
      child.on("error", reject);
      child.on("close", (status) => resolve({ status, stderr, stdout }));
    },
  );
}

function lifecycleEnvironment() {
  const environment = { ...process.env };
  delete environment.DATABASE_URL;
  return {
    ...environment,
    OTP_PROVIDER: "dev",
    SEVO_RUNTIME_ENV: "test",
  };
}

function docker(argumentsList: string[]) {
  return spawnSync("docker", argumentsList, { encoding: "utf8" });
}

function projectResources(projectName: string) {
  const list = (resource: "container" | "network" | "volume") => {
    const result = docker([
      resource,
      "ls",
      ...(resource === "container" ? ["--all"] : []),
      "--quiet",
      "--filter",
      `label=com.docker.compose.project=${projectName}`,
    ]);
    expect(result.status, result.stderr).toBe(0);
    return result.stdout.trim() ? result.stdout.trim().split("\n") : [];
  };
  return {
    containers: list("container"),
    networks: list("network"),
    volumes: list("volume"),
  };
}

function formatLifecycleResult(result: {
  status: number | null;
  stderr: string;
  stdout: string;
}) {
  return `status=${result.status}\nstdout=${result.stdout}\nstderr=${result.stderr}`;
}

function cleanupEvents(output: string) {
  return output
    .split("\n")
    .filter((line) => line.includes(`"event":"${QA_PROJECT_CLEANUP_EVENT}"`))
    .map((line) => JSON.parse(line) as { event: string; projectName: string });
}

function parseLastJsonLine(output: string) {
  const line = output
    .trim()
    .split("\n")
    .findLast((candidate) => candidate.startsWith("{"));
  if (!line) throw new Error("QA lifecycle did not return its target report");
  return JSON.parse(line) as { fingerprint: string; projectName: string };
}
