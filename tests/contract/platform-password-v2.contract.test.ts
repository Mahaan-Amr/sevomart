import { describe, expect, it } from "vitest";
import {
  createIdentityAccessV2JsonSchemas,
  platformPasswordRecoveryContract,
  platformPasswordRecoveryIssuedContract,
} from "@sevo/contracts/identity-access/v2";

describe("platform recovery code contract", () => {
  it("accepts Persian and Arabic digits in input while issued codes stay ASCII", () => {
    for (const digit of ["۰", "٠", "0"]) {
      expect(
        platformPasswordRecoveryContract.safeParse({
          code: digit.repeat(43),
          password: "new secure password",
        }).success,
      ).toBe(true);
    }
    expect(
      platformPasswordRecoveryIssuedContract.safeParse({
        code: "۰".repeat(43),
        expiresAt: "2026-08-27T09:00:00.000Z",
      }).success,
    ).toBe(false);
    const schemas = createIdentityAccessV2JsonSchemas() as Record<
      string,
      { properties: { code: { pattern: string } } }
    >;
    const inputPattern = new RegExp(
      schemas.PlatformPasswordRecovery!.properties.code.pattern,
    );
    expect(inputPattern.test("۰".repeat(43))).toBe(true);
    expect(inputPattern.test("٠".repeat(43))).toBe(true);
    expect(
      new RegExp(schemas.PlatformPasswordRecoveryIssued!.properties.code.pattern).test(
        "۰".repeat(43),
      ),
    ).toBe(false);
  });
});
