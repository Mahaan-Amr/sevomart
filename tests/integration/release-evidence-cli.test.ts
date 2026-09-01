import { spawnSync } from "node:child_process";

import { expect, it } from "vitest";

it("rejects a plan whose SHA is not the checked-out candidate", () => {
  const result = spawnSync(
    process.execPath,
    [
      "scripts/release-evidence.mjs",
      "plan",
      "--sha",
      "a".repeat(40),
      "--migration",
      "20260831150000__platform__track-demo-seed-resources",
      "--seed-version",
      "2",
      "--health-api",
      "output/health/api.json",
      "--health-web",
      "output/health/web.json",
      "--health-worker",
      "output/health/worker.json",
      "--startup-docker",
      "output/startup/docker.json",
      "--startup-native",
      "output/startup/native.json",
      "--author",
      "Mahaan-Amr",
      "--output",
      "output/release-evidence/should-not-exist.json",
    ],
    { encoding: "utf8" },
  );

  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("does not match checked-out HEAD");
});
