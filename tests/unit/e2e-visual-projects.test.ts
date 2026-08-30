import { describe, expect, it } from "vitest";

import { allE2eTestMobiles } from "../helpers/visual-projects";

describe("E2E visual project fixtures", () => {
  it("assigns every scenario owner a distinct mobile", () => {
    expect(new Set(allE2eTestMobiles).size).toBe(allE2eTestMobiles.length);
  });
});
