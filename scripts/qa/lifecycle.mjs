import { spawnSync } from "node:child_process";

import { createPostgresDemoSeedDatabase } from "../demo/postgres.mjs";
import { createQaLifecycleRequest } from "./runtime.mjs";

const request = createQaLifecycleRequest(process.argv.slice(2));
const lifecycleEnvironment = { ...process.env };
delete lifecycleEnvironment.DATABASE_URL;
Object.assign(lifecycleEnvironment, {
  POSTGRES_DB: request.databaseName,
  POSTGRES_USER: "sevo",
  POSTGRES_PASSWORD: "sevo_local",
  POSTGRES_HOST_PORT: "0",
  MINIO_ROOT_USER: "sevo_local",
  MINIO_ROOT_PASSWORD: "sevo_local_password",
  MINIO_HOST_PORT: "0",
  MINIO_CONSOLE_HOST_PORT: "0",
});

function run(command, commandArguments, options = {}) {
  const result = spawnSync(command, commandArguments, {
    encoding: options.capture ? "utf8" : undefined,
    env: options.environment ?? lifecycleEnvironment,
    shell: process.platform === "win32",
    stdio: options.capture ? "pipe" : "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      options.capture && result.stderr
        ? result.stderr.trim()
        : `${command} exited with status ${result.status}`,
    );
  }
  return options.capture ? result.stdout.trim() : "";
}

function compose(commandArguments, options) {
  return run(
    "docker",
    ["compose", "--project-name", request.projectName, ...commandArguments],
    options,
  );
}

function publishedPort(service, containerPort) {
  const output = compose(["port", service, String(containerPort)], { capture: true });
  const port = Number(output.slice(output.lastIndexOf(":") + 1));
  if (!Number.isInteger(port) || port < 1) {
    throw new Error(`Unable to resolve the ${service} QA port`);
  }
  return port;
}

async function inspectQaTarget(databaseUrl) {
  const database = createPostgresDemoSeedDatabase(databaseUrl);
  try {
    const target = await database.inspectTarget();
    if (target.profile !== "qa" || target.databaseName !== request.databaseName) {
      throw new Error("QA target profile or database name does not match the run id");
    }
    return target;
  } finally {
    await database.close();
  }
}

async function bringUp() {
  let started = false;
  try {
    compose(["up", "-d", "--wait", "postgres", "minio"]);
    started = true;
    const databasePort = publishedPort("postgres", 5432);
    const minioPort = publishedPort("minio", 9000);
    const databaseUrl = `postgresql://sevo:sevo_local@127.0.0.1:${databasePort}/${request.databaseName}`;
    run("pnpm", ["--filter", "@sevo/database", "exec", "prisma", "migrate", "deploy"], {
      environment: { ...lifecycleEnvironment, DATABASE_URL: databaseUrl },
    });
    const target = await inspectQaTarget(databaseUrl);
    process.stdout.write(
      `${JSON.stringify({
        profile: request.profile,
        runId: request.runId,
        projectName: request.projectName,
        databaseName: request.databaseName,
        databasePort,
        minioPort,
        fingerprint: target.fingerprint,
      })}\n`,
    );
  } catch (error) {
    if (started) {
      try {
        compose(["down", "--volumes", "--remove-orphans"]);
      } catch {
        // Preserve the startup failure; the exact project name is printed in its error.
      }
    }
    throw error;
  }
}

async function tearDown() {
  const databasePort = publishedPort("postgres", 5432);
  const databaseUrl = `postgresql://sevo:sevo_local@127.0.0.1:${databasePort}/${request.databaseName}`;
  const target = await inspectQaTarget(databaseUrl);
  if (target.fingerprint !== request.fingerprint) {
    throw new Error(
      "QA target fingerprint does not match --fingerprint; teardown refused",
    );
  }
  compose(["down", "--volumes", "--remove-orphans"]);
  process.stdout.write(
    `${JSON.stringify({
      profile: request.profile,
      runId: request.runId,
      projectName: request.projectName,
      fingerprint: request.fingerprint,
      removed: true,
    })}\n`,
  );
}

await (request.action === "up" ? bringUp() : tearDown());
