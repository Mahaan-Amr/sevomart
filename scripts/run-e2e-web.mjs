import { spawn, spawnSync } from "node:child_process";

const pnpmEntryPoint = process.env.npm_execpath;
if (!pnpmEntryPoint) throw new Error("pnpm entry point is unavailable");
const webPort = process.env.WEB_PORT ?? "3110";

const build = spawnSync(
  process.execPath,
  [pnpmEntryPoint, "--filter", "@sevo/web", "build"],
  { env: process.env, stdio: "inherit" },
);
if (build.error) throw build.error;
if (build.status !== 0) process.exit(build.status ?? 1);

const web = spawn(
  process.execPath,
  [pnpmEntryPoint, "--filter", "@sevo/web", "start", "--port", webPort],
  { env: process.env, stdio: "inherit" },
);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => web.kill(signal));
}

web.once("exit", (code) => {
  process.exitCode = code ?? 0;
});
