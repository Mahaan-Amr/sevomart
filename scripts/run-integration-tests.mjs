import { spawnSync } from "node:child_process";

const onWindows = process.platform === "win32";

function run(command, args, environment = process.env) {
  const result = spawnSync(command, args, {
    env: environment,
    shell: onWindows,
    stdio: "inherit",
  });

  if (result.error) {
    throw result.error;
  }

  return result.status ?? 1;
}

const managesLocalInfrastructure = !process.env.DATABASE_URL;
const composeProject = "sevomart-integration";
const integrationEnvironment = managesLocalInfrastructure
  ? {
      ...process.env,
      DATABASE_URL: "postgresql://sevo:sevo_local@localhost:7432/sevo",
      POSTGRES_HOST_PORT: "7432",
      MINIO_ENDPOINT: "127.0.0.1",
      MINIO_PORT: "10100",
      MINIO_HOST_PORT: "10100",
      MINIO_CONSOLE_HOST_PORT: "10101",
    }
  : process.env;

function runCompose(args) {
  return run(
    "docker",
    ["compose", "--project-name", composeProject, ...args],
    integrationEnvironment,
  );
}

let testStatus = 1;

try {
  let infrastructureStatus = 0;
  if (managesLocalInfrastructure) {
    infrastructureStatus = runCompose(["up", "-d", "--wait", "postgres", "minio"]);
  }

  if (infrastructureStatus !== 0) {
    testStatus = infrastructureStatus;
  } else {
    const migrationStatus = run(
      "pnpm",
      ["--filter", "@sevo/database", "exec", "prisma", "migrate", "deploy"],
      integrationEnvironment,
    );

    if (migrationStatus !== 0) {
      testStatus = migrationStatus;
    } else {
      testStatus = run(
        "pnpm",
        ["exec", "vitest", "run", "--config", "vitest.integration.config.ts"],
        integrationEnvironment,
      );
    }
  }
} finally {
  if (managesLocalInfrastructure) {
    const teardownStatus = runCompose(["down", "--volumes", "--remove-orphans"]);
    if (testStatus === 0 && teardownStatus !== 0) {
      testStatus = teardownStatus;
    }
  }
}

process.exit(testStatus);
