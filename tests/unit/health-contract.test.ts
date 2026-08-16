import { describe, expect, it } from "vitest";

import { healthResponseContract } from "../../packages/contracts/src/health";

describe("health response contract", () => {
  it("accepts the stable response exposed to web and operations", () => {
    expect(
      healthResponseContract.safeParse({
        status: "ok",
        service: "api",
        version: 1,
      }).success,
    ).toBe(true);
  });

  it("rejects a response that silently changes the contract version", () => {
    expect(
      healthResponseContract.safeParse({
        status: "ok",
        service: "api",
        version: 2,
      }).success,
    ).toBe(false);
  });
});
