import { spawnSync } from "node:child_process";

const pnpmEntryPoint = process.env.npm_execpath;

if (!pnpmEntryPoint) {
  throw new Error("pnpm entry point is unavailable");
}

const result = spawnSync(
  process.execPath,
  [pnpmEntryPoint, "-r", "--parallel", "--stream", "--if-present", "dev"],
  {
    env: process.env,
    stdio: "inherit",
  },
);

if (result.error) {
  throw result.error;
}

process.exitCode = result.status ?? 1;
