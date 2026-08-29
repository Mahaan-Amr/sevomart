import { parseCommandOptions } from "../demo/runtime.mjs";

const runIdPattern = /^[a-z0-9][a-z0-9-]{2,30}$/;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
  if (action === "down" && (!fingerprint || !uuidPattern.test(fingerprint))) {
    throw new Error("an explicit UUID --fingerprint is required before QA teardown");
  }

  return Object.freeze({
    action,
    databaseName: `sevo_qa_${runId.replaceAll("-", "_")}`,
    ...(fingerprint ? { fingerprint } : {}),
    profile: "qa",
    projectName: `sevomart-qa-${runId}`,
    runId,
  });
}
