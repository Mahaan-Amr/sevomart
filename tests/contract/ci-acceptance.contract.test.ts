import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
const productionDockerfiles = [
  "apps/api/Dockerfile",
  "apps/web/Dockerfile",
  "apps/worker/Dockerfile",
  "packages/database/Dockerfile",
];

describe("first-slice CI acceptance contract", () => {
  it("retains every Playwright failure artifact and fails if one is missing", () => {
    expect(workflow).toMatch(
      /id: playwright[\s\S]*?run: pnpm test:e2e[\s\S]*?if: failure\(\) && steps\.playwright\.outcome == 'failure'/,
    );
    expect(workflow).toContain("output/playwright-report");
    expect(workflow).toContain("output/playwright-results");
    expect(workflow).toContain("if-no-files-found: error");
  });

  it.each(["apps/api/Dockerfile", "apps/web/Dockerfile", "apps/worker/Dockerfile"])(
    "builds the production image from %s",
    (dockerfile) => {
      expect(workflow).toContain(`dockerfile: ${dockerfile}`);
    },
  );

  it.each(productionDockerfiles)(
    "copies pnpm patches before installing dependencies in %s",
    (dockerfile) => {
      const contents = readFileSync(dockerfile, "utf8");
      const patchesCopy = contents.indexOf("COPY patches ./patches");
      const install = contents.indexOf("pnpm install --frozen-lockfile");

      expect(patchesCopy).toBeGreaterThan(-1);
      expect(install).toBeGreaterThan(patchesCopy);
    },
  );
});
