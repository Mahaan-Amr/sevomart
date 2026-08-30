import { spawnSync } from "node:child_process";

export function createQaCommandRunner({
  environment,
  platform = process.platform,
  spawn = spawnSync,
}) {
  function execute(command, commandArguments, options = {}) {
    const result = spawn(command, commandArguments, {
      encoding: options.capture ? "utf8" : undefined,
      env: options.environment ?? environment,
      shell: options.shell ?? platform === "win32",
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

  return Object.freeze({
    command: execute,
    docker: (commandArguments, options = {}) =>
      execute("docker", commandArguments, { ...options, shell: false }),
  });
}
