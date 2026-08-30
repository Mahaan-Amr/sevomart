import { randomUUID } from "node:crypto";

import { createPostgresDemoSeedDatabase } from "../demo/postgres.mjs";
import { createQaCommandRunner } from "./command-runner.mjs";
import {
  assertQaProjectIsAbsent,
  createQaLifecycleRequest,
  publishQaTargetReport,
  QA_PROJECT_CLEANUP_EVENT,
} from "./runtime.mjs";
import { runOwnedQaStartup } from "./startup-ownership.mjs";

const request = createQaLifecycleRequest(process.argv.slice(2));
const ownershipVolume = `${request.projectName}-owner`;
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
const commands = createQaCommandRunner({ environment: lifecycleEnvironment });

function compose(commandArguments, options) {
  return commands.docker(
    ["compose", "--project-name", request.projectName, ...commandArguments],
    options,
  );
}

function removeProject() {
  process.stderr.write(
    `${JSON.stringify({
      event: QA_PROJECT_CLEANUP_EVENT,
      projectName: request.projectName,
    })}\n`,
  );
  compose(["down", "--volumes", "--remove-orphans"]);
}

function projectResourceIds(resourceType) {
  const allOption = resourceType === "container" ? ["--all"] : [];
  const output = commands.docker(
    [
      resourceType,
      "ls",
      ...allOption,
      "--quiet",
      "--filter",
      `label=com.docker.compose.project=${request.projectName}`,
    ],
    { capture: true },
  );
  return output ? output.split("\n") : [];
}

function assertProjectAbsent() {
  assertQaProjectIsAbsent({
    containers: projectResourceIds("container"),
    networks: projectResourceIds("network"),
    volumes: projectResourceIds("volume"),
  });
}

function readOwnershipToken() {
  return commands.docker(
    [
      "volume",
      "inspect",
      "--format",
      '{{ index .Labels "sevo.qa.owner-token" }}',
      ownershipVolume,
    ],
    { capture: true },
  );
}

function acquireOwnership() {
  const token = randomUUID();
  commands.docker(
    [
      "volume",
      "create",
      "--label",
      `sevo.qa.owner-token=${token}`,
      "--label",
      `sevo.qa.run-id=${request.runId}`,
      ownershipVolume,
    ],
    { capture: true },
  );
  if (readOwnershipToken() !== token) {
    throw new Error("This QA run id is already owned by another lifecycle process");
  }
  return token;
}

function releaseOwnership(token) {
  if (readOwnershipToken() !== token) {
    throw new Error("QA lifecycle ownership changed; refusing to release its lease");
  }
  commands.docker(["volume", "rm", ownershipVolume], { capture: true });
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
  await runOwnedQaStartup({
    acquireOwnership,
    assertProjectAbsent,
    startProject: () => compose(["up", "-d", "--wait", "postgres", "minio"]),
    initializeProject: async () => {
      const databasePort = publishedPort("postgres", 5432);
      const minioPort = publishedPort("minio", 9000);
      const databaseUrl = `postgresql://sevo:sevo_local@127.0.0.1:${databasePort}/${request.databaseName}`;
      commands.command(
        "pnpm",
        ["--filter", "@sevo/database", "exec", "prisma", "migrate", "deploy"],
        {
          environment: { ...lifecycleEnvironment, DATABASE_URL: databaseUrl },
        },
      );
      const target = await inspectQaTarget(databaseUrl);
      publishQaTargetReport({
        profile: request.profile,
        runId: request.runId,
        projectName: request.projectName,
        databaseName: request.databaseName,
        databasePort,
        minioPort,
        fingerprint: target.fingerprint,
      });
    },
    cleanupProject: removeProject,
    releaseOwnership,
  });
}

async function tearDown() {
  const ownershipToken = readOwnershipToken();
  if (!ownershipToken) {
    throw new Error("QA lifecycle ownership lease is missing; teardown refused");
  }
  const databasePort = publishedPort("postgres", 5432);
  const databaseUrl = `postgresql://sevo:sevo_local@127.0.0.1:${databasePort}/${request.databaseName}`;
  const target = await inspectQaTarget(databaseUrl);
  if (target.fingerprint !== request.fingerprint) {
    throw new Error(
      "QA target fingerprint does not match --fingerprint; teardown refused",
    );
  }
  removeProject();
  releaseOwnership(ownershipToken);
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
