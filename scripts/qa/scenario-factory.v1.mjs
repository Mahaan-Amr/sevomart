import { createHash, randomUUID } from "node:crypto";

import {
  assertQaScenarioCallbackEnvironment,
  createQaScenarioCallbackEnvironment,
} from "./scenario-environment.mjs";
import { createQaTargetNames, isQaFingerprint } from "./runtime.mjs";

const scenarioNamePattern = /^[a-z0-9][a-z0-9-]{2,17}$/;
const randomIdPattern = /^[a-z0-9]{12}$/;
const fixedTimePattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const urlNamespace = Buffer.from("6ba7b8119dad11d180b400c04fd430c8", "hex");

export const QA_SCENARIO_CONTRACT_VERSION = 1;

export function createQaScenarioFactory({
  environment = process.env,
  lifecycle,
  randomId = () => randomUUID().replaceAll("-", "").slice(0, 12),
}) {
  if (
    !lifecycle ||
    typeof lifecycle.up !== "function" ||
    typeof lifecycle.down !== "function"
  ) {
    throw new Error("QA scenario factory requires a disposable lifecycle adapter");
  }

  return Object.freeze({
    async withScenario(definition, exercise) {
      const request = createScenarioRequest(definition, randomId);
      if (typeof definition.build !== "function" || typeof exercise !== "function") {
        throw new Error("QA scenario requires build and exercise functions");
      }

      let failure;
      let result;
      let target;
      try {
        const reportedTarget = await lifecycle.up(request.runId);
        if (isQaFingerprint(reportedTarget?.fingerprint)) {
          target = reportedTarget;
        }
        target = assertTarget(reportedTarget, request);
        const baseContext = createBaseContext(request, target, environment);
        assertQaScenarioCallbackEnvironment(baseContext.environment, target);
        const data = await definition.build(baseContext);
        assertQaScenarioCallbackEnvironment(baseContext.environment, target);
        result = await exercise(Object.freeze({ ...baseContext, data }));
      } catch (error) {
        failure = error;
      }

      if (target) {
        try {
          await lifecycle.down({
            fingerprint: target.fingerprint,
            runId: request.runId,
          });
        } catch (teardownError) {
          if (failure) {
            throw new AggregateError(
              [failure, teardownError],
              "QA scenario failed and its owned environment could not be removed",
              { cause: teardownError },
            );
          }
          throw teardownError;
        }
      }

      if (failure) throw failure;
      return result;
    },
  });
}

function createScenarioRequest(definition, randomId) {
  if (!definition || !scenarioNamePattern.test(definition.name ?? "")) {
    throw new Error(
      "QA scenario name must contain 3 to 18 lowercase letters, digits or dashes",
    );
  }
  if (
    !fixedTimePattern.test(definition.fixedTime ?? "") ||
    new Date(definition.fixedTime).toISOString() !== definition.fixedTime
  ) {
    throw new Error("QA scenario fixedTime must be an exact UTC ISO timestamp");
  }
  const suffix = randomId();
  if (!randomIdPattern.test(suffix)) {
    throw new Error("QA scenario random id must contain exactly 12 letters or digits");
  }
  const runId = `${definition.name}-${suffix}`;
  return Object.freeze({
    fixedTime: definition.fixedTime,
    namespace: `sevo.qa.${runId}`,
    runId,
  });
}

function assertTarget(target, request) {
  const expectedTarget = createQaTargetNames(request.runId);
  if (
    target?.profile !== "qa" ||
    target.runId !== request.runId ||
    target.projectName !== expectedTarget.projectName ||
    target.databaseName !== expectedTarget.databaseName ||
    !isQaFingerprint(target.fingerprint) ||
    !validPort(target.databasePort) ||
    !validPort(target.minioPort)
  ) {
    throw new Error("QA lifecycle returned a target outside the requested run");
  }
  return Object.freeze({ ...target });
}

function createBaseContext(request, target, environment) {
  const fixedTime = request.fixedTime;
  const callbackEnvironment = createQaScenarioCallbackEnvironment(target, environment);
  return Object.freeze({
    contractVersion: QA_SCENARIO_CONTRACT_VERSION,
    runId: request.runId,
    namespace: request.namespace,
    clock: Object.freeze({ now: () => new Date(fixedTime) }),
    id: (name) => namespacedUuid(request.namespace, name),
    environment: callbackEnvironment,
    database: Object.freeze({
      name: target.databaseName,
      url: `postgresql://sevo:sevo_local@127.0.0.1:${target.databasePort}/${target.databaseName}`,
    }),
    objectStorage: Object.freeze({
      bucket: callbackEnvironment.MINIO_BUCKET,
      endpoint: `http://127.0.0.1:${target.minioPort}`,
    }),
  });
}

function namespacedUuid(namespace, name) {
  if (!/^[a-z0-9][a-z0-9.-]{1,79}$/.test(name ?? "")) {
    throw new Error("QA scenario id name must be a stable lowercase key");
  }
  const digest = createHash("sha1")
    .update(urlNamespace)
    .update(`${namespace}:${name}`)
    .digest()
    .subarray(0, 16);
  digest[6] = (digest[6] & 0x0f) | 0x50;
  digest[8] = (digest[8] & 0x3f) | 0x80;
  const hex = digest.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function validPort(value) {
  return Number.isInteger(value) && value > 0 && value <= 65_535;
}
