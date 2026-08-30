export function createQaScenarioProcessEnvironment(environment = process.env) {
  const qaEnvironment = {
    ...environment,
    OTP_PROVIDER: "dev",
    SEVO_RUNTIME_ENV: "test",
  };
  delete qaEnvironment.DATABASE_URL;
  return qaEnvironment;
}

export function assertQaScenarioProcessEnvironment(environment = process.env) {
  if (environment.DATABASE_URL) {
    throw new Error("QA scenarios reject inherited DATABASE_URL");
  }
  if (environment.SEVO_RUNTIME_ENV !== "test") {
    throw new Error("QA scenarios require explicit SEVO_RUNTIME_ENV=test");
  }
  if (environment.OTP_PROVIDER !== "dev") {
    throw new Error("QA scenarios require the internal development provider");
  }
}
