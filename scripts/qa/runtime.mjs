import { writeFileSync } from "node:fs";

import { parseCommandOptions } from "../demo/runtime.mjs";

const runIdPattern = /^[a-z0-9][a-z0-9-]{2,30}$/;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const QA_PROJECT_CLEANUP_EVENT = "qa-project-cleanup";

export function isQaFingerprint(value) {
  return typeof value === "string" && uuidPattern.test(value);
}

export function publishQaTargetReport(
  report,
  {
    environment = process.env,
    writeReport = (descriptor, payload) => writeFileSync(descriptor, payload),
    writeStdout = (payload) => process.stdout.write(payload),
  } = {},
) {
  const serializedReport = `${JSON.stringify(report)}\n`;
  if (environment.SEVO_QA_REPORT_FD !== undefined) {
    if (environment.SEVO_QA_REPORT_FD !== "3") {
      throw new Error("QA lifecycle report descriptor must be 3");
    }
    writeReport(3, serializedReport);
    return;
  }
  writeStdout(serializedReport);
}

export function createQaTargetNames(runId) {
  return Object.freeze({
    databaseName: `sevo_qa_${runId.replaceAll("-", "_")}`,
    projectName: `sevomart-qa-${runId}`,
  });
}

export function assertQaProjectIsAbsent(resources) {
  const existingResource = Object.values(resources).some((resourceIds) =>
    resourceIds.some(Boolean),
  );
  if (existingResource) {
    throw new Error(
      "This QA run id already owns Docker resources; choose a new --run-id",
    );
  }
}

export function createQaLifecycleRequest(argumentsList, environment = process.env) {
  if (environment.SEVO_RUNTIME_ENV !== "test") {
    throw new Error("QA lifecycle requires explicit SEVO_RUNTIME_ENV=test");
  }
  if (environment.DATABASE_URL) {
    throw new Error("QA lifecycle rejects inherited DATABASE_URL");
  }
  if (environment.OTP_PROVIDER !== "dev") {
    throw new Error("QA lifecycle requires the internal development provider");
  }

  const action = argumentsList[0];
  if (action !== "up" && action !== "down") {
    throw new Error("QA lifecycle action must be up or down");
  }
  const options = parseCommandOptions(argumentsList.slice(1));
  if (options.get("--profile") !== "qa") {
    throw new Error("--profile qa is required");
  }
  const runId = options.get("--run-id");
  if (!runId || !runIdPattern.test(runId)) {
    throw new Error(
      "--run-id must contain 3 to 31 lowercase letters, digits or dashes",
    );
  }
  const fingerprint = options.get("--fingerprint");
  if (action === "down" && !isQaFingerprint(fingerprint)) {
    throw new Error("an explicit UUID --fingerprint is required before QA teardown");
  }

  return Object.freeze({
    action,
    ...createQaTargetNames(runId),
    ...(fingerprint ? { fingerprint } : {}),
    profile: "qa",
    runId,
  });
}
