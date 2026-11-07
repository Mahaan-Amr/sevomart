import { describe, expect, it } from "vitest";
import { guideProgress } from "./seller-home-progress";

describe("seller home progress", () => {
  it("advances only after publication and first saved product", () => {
    expect(guideProgress(false, false)).toBe(1);
    expect(guideProgress(true, false)).toBe(2);
    expect(guideProgress(true, true)).toBe(3);
    expect(guideProgress(false, true)).toBe(1);
  });
});
