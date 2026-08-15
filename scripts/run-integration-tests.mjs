import { spawnSync } from "node:child_process";

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

if (!process.env.DATABASE_URL) {
  const composeStatus = run("docker", ["compose", "up", "-d", "--wait", "postgres"]);

  if (composeStatus !== 0) {
    process.exit(composeStatus);
  }
}

process.exit(
  run("pnpm", ["exec", "vitest", "run", "--config", "vitest.integration.config.ts"]),
);
