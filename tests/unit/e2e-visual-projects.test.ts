import { describe, expect, it } from "vitest";

import { allE2eTestMobiles, visualProjectIndex } from "../helpers/visual-projects";

describe("E2E visual project fixtures", () => {
  it("assigns every scenario owner a distinct mobile", () => {
    expect(new Set(allE2eTestMobiles).size).toBe(allE2eTestMobiles.length);
  });

  it("reuses deterministic fixture slots for the two WebKit candidate smokes", () => {
    expect(visualProjectIndex("webkit-390x844")).toBe(1);
    expect(visualProjectIndex("webkit-1440x900")).toBe(3);
  });
});
