import { spawnSync } from "node:child_process";

import { createQaScenarioProcessEnvironment } from "./qa/scenario-environment.mjs";

const result = spawnSync(
  "pnpm",
  ["exec", "vitest", "run", "--config", "vitest.qa-scenario.config.ts"],
  {
    env: createQaScenarioProcessEnvironment(),
    shell: process.platform === "win32",
    stdio: "inherit",
  },
);

if (result.error) throw result.error;
process.exit(result.status ?? 1);
