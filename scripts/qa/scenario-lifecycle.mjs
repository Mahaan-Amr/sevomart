import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const lifecycleScript = fileURLToPath(new URL("./lifecycle.mjs", import.meta.url));
const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));

export function createQaScenarioLifecycle({
  environment = process.env,
  spawn = spawnSync,
} = {}) {
  const lifecycleEnvironment = {
    ...environment,
    OTP_PROVIDER: "dev",
    SEVO_RUNTIME_ENV: "test",
  };
  delete lifecycleEnvironment.DATABASE_URL;

  function run(argumentsList) {
    const result = spawn(process.execPath, [lifecycleScript, ...argumentsList], {
      cwd: repositoryRoot,
      encoding: "utf8",
      env: lifecycleEnvironment,
      shell: false,
      stdio: "pipe",
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(
        result.stderr?.trim() || `QA lifecycle exited with status ${result.status}`,
      );
    }
    return result.stdout ?? "";
  }

  return Object.freeze({
    async up(runId) {
      const output = run(["up", "--profile", "qa", "--run-id", runId]);
      return parseTargetReport(output);
    },
    async down({ fingerprint, runId }) {
      run(["down", "--profile", "qa", "--run-id", runId, "--fingerprint", fingerprint]);
    },
  });
}

function parseTargetReport(output) {
  const reportLine = output
    .trim()
    .split("\n")
    .findLast((line) => line.trim().startsWith("{"));
  if (!reportLine) {
    throw new Error("QA lifecycle did not return its disposable target report");
  }
  try {
    return JSON.parse(reportLine);
  } catch {
    throw new Error("QA lifecycle returned an invalid disposable target report");
  }
}
