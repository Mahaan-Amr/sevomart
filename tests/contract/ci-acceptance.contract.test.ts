import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const workflow = readFileSync(".github/workflows/ci.yml", "utf8");

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
});
