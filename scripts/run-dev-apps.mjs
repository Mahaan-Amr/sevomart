import { spawnSync } from "node:child_process";

const pnpmEntryPoint = process.env.npm_execpath;
const developmentEnvironment = {
  ...process.env,
  API_PORT: process.env.API_PORT ?? "3201",
  WORKER_PORT: process.env.WORKER_PORT ?? "3202",
  PORT: process.env.PORT ?? "3200",
  WEB_ORIGIN: process.env.WEB_ORIGIN ?? "http://localhost:3200",
  API_BASE_URL: process.env.API_BASE_URL ?? "http://127.0.0.1:3201",
  API_READINESS_URL:
    process.env.API_READINESS_URL ?? "http://127.0.0.1:3201/health/ready",
};

if (!pnpmEntryPoint) {
  throw new Error("pnpm entry point is unavailable");
}

const result = spawnSync(
  process.execPath,
  [pnpmEntryPoint, "-r", "--parallel", "--stream", "--if-present", "dev"],
  {
    env: developmentEnvironment,
    stdio: "inherit",
  },
);

if (result.error) {
  throw result.error;
}

process.exitCode = result.status ?? 1;
