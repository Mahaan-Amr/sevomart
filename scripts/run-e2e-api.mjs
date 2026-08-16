import { spawn, spawnSync } from "node:child_process";

import postgres from "postgres";

const databaseUrl =
  process.env.DATABASE_URL ?? "postgresql://sevo:sevo_local@localhost:6432/sevo";
const pnpmEntryPoint = process.env.npm_execpath;

if (!pnpmEntryPoint) throw new Error("pnpm entry point is unavailable");

async function databaseIsReady() {
  const sql = postgres(databaseUrl, { connect_timeout: 2, max: 1 });
  try {
    await sql`select 1`;
    return true;
  } catch {
    return false;
  } finally {
    await sql.end({ timeout: 1 });
  }
}

function runPnpm(args) {
  const result = spawnSync(process.execPath, [pnpmEntryPoint, ...args], {
    env: process.env,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (!(await databaseIsReady())) runPnpm(["db:up"]);
runPnpm(["--filter", "@sevo/database", "exec", "prisma", "migrate", "deploy"]);
runPnpm(["build:packages"]);

const api = spawn(process.execPath, [pnpmEntryPoint, "--filter", "@sevo/api", "dev"], {
  env: process.env,
  stdio: "inherit",
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => api.kill(signal));
}

api.once("exit", (code) => {
  process.exitCode = code ?? 0;
});
