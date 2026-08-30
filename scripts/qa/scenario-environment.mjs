export function createQaScenarioProcessEnvironment(environment = process.env) {
  const qaEnvironment = { ...environment };
  for (const key of Object.keys(qaEnvironment)) {
    if (
      key === "DATABASE_URL" ||
      key === "OTEL_EXPORTER_OTLP_ENDPOINT" ||
      key.startsWith("MINIO_")
    ) {
      delete qaEnvironment[key];
    }
  }
  Object.assign(qaEnvironment, {
    NODE_ENV: "test",
    OTEL_EXPORTER_OTLP_ENDPOINT: "",
    OTP_PROVIDER: "dev",
    SEVO_RUNTIME_ENV: "test",
  });
  return qaEnvironment;
}

export function createQaScenarioCallbackEnvironment(target, environment = process.env) {
  const callbackEnvironment = {
    ...createQaScenarioProcessEnvironment(environment),
    DATABASE_URL: `postgresql://sevo:sevo_local@127.0.0.1:${target.databasePort}/${target.databaseName}`,
    MINIO_ACCESS_KEY: "sevo_local",
    MINIO_BUCKET: "sevo-media",
    MINIO_ENDPOINT: "127.0.0.1",
    MINIO_PORT: String(target.minioPort),
    MINIO_SECRET_KEY: "sevo_local_password",
    MINIO_USE_SSL: "false",
  };
  assertQaScenarioCallbackEnvironment(callbackEnvironment, target);
  return Object.freeze(callbackEnvironment);
}

export function assertQaScenarioProcessEnvironment(environment = process.env) {
  if (environment.DATABASE_URL) {
    throw new Error("QA scenarios reject inherited DATABASE_URL");
  }
  if (Object.keys(environment).some((key) => key.startsWith("MINIO_"))) {
    throw new Error("QA scenarios reject inherited object-storage providers");
  }
  if (environment.OTEL_EXPORTER_OTLP_ENDPOINT) {
    throw new Error("QA scenarios reject inherited telemetry exporters");
  }
  if (environment.SEVO_RUNTIME_ENV !== "test") {
    throw new Error("QA scenarios require explicit SEVO_RUNTIME_ENV=test");
  }
  if (environment.OTP_PROVIDER !== "dev") {
    throw new Error("QA scenarios require the internal development provider");
  }
}

export function assertQaScenarioCallbackEnvironment(environment, target) {
  const expected = createExpectedCallbackTargets(target);
  for (const [key, value] of Object.entries(expected)) {
    if (environment[key] !== value) {
      throw new Error(`QA scenario callback requires disposable ${key}`);
    }
  }
  if (environment.OTEL_EXPORTER_OTLP_ENDPOINT) {
    throw new Error("QA scenario callback rejects external telemetry exporters");
  }
}

function createExpectedCallbackTargets(target) {
  return {
    DATABASE_URL: `postgresql://sevo:sevo_local@127.0.0.1:${target.databasePort}/${target.databaseName}`,
    MINIO_ACCESS_KEY: "sevo_local",
    MINIO_BUCKET: "sevo-media",
    MINIO_ENDPOINT: "127.0.0.1",
    MINIO_PORT: String(target.minioPort),
    MINIO_SECRET_KEY: "sevo_local_password",
    MINIO_USE_SSL: "false",
    OTP_PROVIDER: "dev",
    SEVO_RUNTIME_ENV: "test",
  };
}
