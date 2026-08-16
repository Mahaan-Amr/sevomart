import { spawnSync } from "node:child_process";

import { databaseIsReady } from "./database-readiness.mjs";

const onWindows = process.platform === "win32";

function run(command, args) {
  const result = spawnSync(command, args, {
    env: process.env,
    shell: onWindows,
    stdio: "inherit",
  });

  if (result.error) {
    throw result.error;
  }

  return result.status ?? 1;
}

const databaseUrl =
  process.env.DATABASE_URL ?? "postgresql://sevo:sevo_local@localhost:6432/sevo";

if (!process.env.DATABASE_URL && !(await databaseIsReady(databaseUrl))) {
  const composeStatus = run("docker", ["compose", "up", "-d", "--wait", "postgres"]);

  if (composeStatus !== 0) {
    process.exit(composeStatus);
  }
}

const migrationStatus = run("pnpm", [
  "--filter",
  "@sevo/database",
  "exec",
  "prisma",
  "migrate",
  "deploy",
]);

if (migrationStatus !== 0) {
  process.exit(migrationStatus);
}

process.exit(
  run("pnpm", ["exec", "vitest", "run", "--config", "vitest.integration.config.ts"]),
);
