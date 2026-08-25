import { spawnSync } from "node:child_process";

const onWindows = process.platform === "win32";
const managesLocalInfrastructure = !process.env.DATABASE_URL;
const composeProject = "sevomart-e2e";
const playwrightArguments = process.argv
  .slice(2)
  .filter((argument) => argument !== "--");
const e2eEnvironment = managesLocalInfrastructure
  ? {
      ...process.env,
      DATABASE_URL: "postgresql://sevo:sevo_local@localhost:8432/sevo",
      POSTGRES_HOST_PORT: "8432",
      MINIO_ENDPOINT: "127.0.0.1",
      MINIO_PORT: "10200",
      MINIO_HOST_PORT: "10200",
      MINIO_CONSOLE_HOST_PORT: "10201",
      MINIO_USE_SSL: "false",
      SEVO_E2E_ISOLATED: "1",
    }
  : process.env;

function run(command, args) {
  const result = spawnSync(command, args, {
    env: e2eEnvironment,
    shell: onWindows,
    stdio: "inherit",
  });

  if (result.error) throw result.error;
  return result.status ?? 1;
}

function runCompose(args) {
  return run("docker", ["compose", "--project-name", composeProject, ...args]);
}

function inspectComposeStack() {
  return runCompose(["ps", "--all"]);
}

function resetComposeStack() {
  const inspectionStatus = inspectComposeStack();
  return inspectionStatus === 0
    ? runCompose(["down", "--volumes", "--remove-orphans"])
    : inspectionStatus;
}

let testStatus = 1;

try {
  let infrastructureStatus = 0;
  if (managesLocalInfrastructure) {
    infrastructureStatus = resetComposeStack();
    if (infrastructureStatus === 0) {
      infrastructureStatus = runCompose(["up", "-d", "--wait", "postgres", "minio"]);
    }
  }

  testStatus =
    infrastructureStatus === 0
      ? run("pnpm", ["exec", "playwright", "test", ...playwrightArguments])
      : infrastructureStatus;
} finally {
  if (managesLocalInfrastructure) {
    const teardownStatus = resetComposeStack();
    if (testStatus === 0 && teardownStatus !== 0) testStatus = teardownStatus;
  }
}

process.exit(testStatus);
