import { describe, expect, it } from "vitest";

import { axisValueErrorId, domIdPart } from "./product-builder-dom";

describe("product builder field IDs", () => {
  it("encodes contract-valid client keys containing whitespace as one ID token", () => {
    const part = domIdPart("red small");

    expect(part).toBe("red%20small");
    expect(part).not.toMatch(/\s/u);
  });

  it("keeps equal value keys unique across different axes", () => {
    const colorValue = axisValueErrorId("color axis", "default");
    const sizeValue = axisValueErrorId("size axis", "default");

    expect(colorValue).not.toBe(sizeValue);
    expect([colorValue, sizeValue].every((id) => !/\s/u.test(id))).toBe(true);
  });
});
