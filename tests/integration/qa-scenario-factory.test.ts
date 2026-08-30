import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";

import postgres from "postgres";
import { describe, expect, it } from "vitest";

import { withQaScenario } from "../../scripts/qa/scenario.v1.mjs";
import { QA_PROJECT_CLEANUP_EVENT } from "../../scripts/qa/runtime.mjs";

describe("isolated QA scenario factory", () => {
  it("builds minimal fixed-time data and removes the whole owned run", async () => {
    let projectName = "";

    expect(process.env).not.toHaveProperty("DATABASE_URL");
    expect(process.env).toMatchObject({
      OTP_PROVIDER: "dev",
      SEVO_RUNTIME_ENV: "test",
    });

    await withQaScenario(
      {
        name: "minimal-identity",
        fixedTime: "2026-08-30T08:30:00.000Z",
        async build(scenario) {
          const sql = postgres(scenario.database.url, { max: 1 });
          const identityId = scenario.id("buyer");
          try {
            await sql`
              insert into identity_identities (id, status, created_at)
              values (${identityId}, 'ACTIVE', ${scenario.clock.now()})
            `;
          } finally {
            await sql.end();
          }
          return Object.freeze({ identityId });
        },
      },
      async (scenario) => {
        projectName = `sevomart-qa-${scenario.runId}`;
        const sql = postgres(scenario.database.url, { max: 1 });
        try {
          expect(scenario.environment).toMatchObject({
            DATABASE_URL: scenario.database.url,
            MINIO_ENDPOINT: "127.0.0.1",
            MINIO_PORT: new URL(scenario.objectStorage.endpoint).port,
            MINIO_SECRET_KEY: "sevo_local_password",
            OTEL_EXPORTER_OTLP_ENDPOINT: "",
          });
          const minioHealth = await fetch(
            `${scenario.objectStorage.endpoint}/minio/health/live`,
          );
          expect(minioHealth.ok).toBe(true);
          const identities = await sql<Array<{ createdAt: Date; id: string }>>`
            select id::text, created_at as "createdAt"
            from identity_identities
          `;
          const demoReceipts = await sql<Array<{ count: number }>>`
            select count(*)::integer as count
            from platform_seed_manifest_receipts
          `;

          expect(identities).toEqual([
            {
              createdAt: new Date("2026-08-30T08:30:00.000Z"),
              id: scenario.data.identityId,
            },
          ]);
          expect(demoReceipts).toEqual([{ count: 0 }]);
          expect(scenario.namespace).toBe(`sevo.qa.${scenario.runId}`);
        } finally {
          await sql.end();
        }
      },
    );

    expect(projectName).not.toBe("");
    expect(projectResources(projectName)).toEqual({
      containers: [],
      networks: [],
      volumes: [],
    });
    expect(docker(["volume", "inspect", `${projectName}-owner`]).status).not.toBe(0);
  }, 120_000);

  it("cleans startup when the required report channel is unavailable", () => {
    const runId = `report-${randomUUID().replaceAll("-", "").slice(0, 20)}`;
    const projectName = `sevomart-qa-${runId}`;
    const environment = {
      ...process.env,
      SEVO_QA_REPORT_FD: "3",
    };
    delete environment.DATABASE_URL;

    const failed = spawnSync(
      process.execPath,
      ["scripts/qa/lifecycle.mjs", "up", "--profile", "qa", "--run-id", runId],
      {
        encoding: "utf8",
        env: environment,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    expect(failed.status).not.toBe(0);
    expect(failed.stderr).toContain(`"event":"${QA_PROJECT_CLEANUP_EVENT}"`);
    expect(projectResources(projectName)).toEqual({
      containers: [],
      networks: [],
      volumes: [],
    });
    expect(docker(["volume", "inspect", `${projectName}-owner`]).status).not.toBe(0);
  }, 120_000);
});

function docker(argumentsList: string[]) {
  return spawnSync("docker", argumentsList, { encoding: "utf8", shell: false });
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
