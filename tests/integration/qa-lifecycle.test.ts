import { spawn, spawnSync } from "node:child_process";

import { afterAll, describe, expect, it } from "vitest";

const runId = `behavior-${process.pid}`;
const raceRunId = `race-${process.pid}`;
let activeTarget:
  | {
      fingerprint: string;
      projectName: string;
    }
  | undefined;
let activeRaceTarget:
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
  if (activeRaceTarget) {
    runLifecycle([
      "down",
      "--profile",
      "qa",
      "--run-id",
      raceRunId,
      "--fingerprint",
      activeRaceTarget.fingerprint,
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

  it("allows only one real concurrent qa:up process to own and clean a run", async () => {
    const contenders = await Promise.all([
      runLifecycleAsync(["up", "--profile", "qa", "--run-id", raceRunId]),
      runLifecycleAsync(["up", "--profile", "qa", "--run-id", raceRunId]),
    ]);
    const winners = contenders.filter(({ status }) => status === 0);
    const losers = contenders.filter(({ status }) => status !== 0);

    expect(winners, contenders.map(formatLifecycleResult).join("\n")).toHaveLength(1);
    expect(losers, contenders.map(formatLifecycleResult).join("\n")).toHaveLength(1);
    expect(losers[0]?.stderr).toContain("already owned");

    activeRaceTarget = parseLastJsonLine(winners[0]?.stdout ?? "");
    const running = docker([
      "compose",
      "--project-name",
      activeRaceTarget.projectName,
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
      `${activeRaceTarget.projectName}-owner`,
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
      raceRunId,
      "--fingerprint",
      activeRaceTarget.fingerprint,
    ]);
    expect(removed.status, removed.stderr).toBe(0);
    expect(projectResources(activeRaceTarget.projectName)).toEqual({
      containers: [],
      networks: [],
      volumes: [],
    });
    const releasedOwnership = docker([
      "volume",
      "inspect",
      `${activeRaceTarget.projectName}-owner`,
    ]);
    expect(releasedOwnership.status).not.toBe(0);
    activeRaceTarget = undefined;
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

function parseLastJsonLine(output: string) {
  const line = output
    .trim()
    .split("\n")
    .findLast((candidate) => candidate.startsWith("{"));
  if (!line) throw new Error("QA lifecycle did not return its target report");
  return JSON.parse(line) as { fingerprint: string; projectName: string };
}
