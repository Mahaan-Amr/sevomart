import { spawn } from "node:child_process";

const pnpmEntryPoint = process.env.npm_execpath;
if (!pnpmEntryPoint) throw new Error("pnpm entry point is unavailable");

const worker = spawn(
  process.execPath,
  [pnpmEntryPoint, "--filter", "@sevo/worker", "dev"],
  { env: process.env, stdio: "inherit" },
);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => worker.kill(signal));
}

worker.once("exit", (code) => {
  process.exitCode = code ?? 0;
});
