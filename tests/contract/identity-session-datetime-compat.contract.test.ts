import { identitySessionContract } from "@sevo/contracts/identity-access/v1";
import { describe, expect, it } from "vitest";

describe("IdentitySession datetime compatibility", () => {
  it("accepts the previously supported minute-precision timestamp with an offset", () => {
    const session = {
      actor: { identityId: "00000000-0000-4000-8000-000000000001", audience: "PUBLIC" },
      maskedMobile: "0900***0000",
      expiresAt: "2026-11-06T12:00+03:30",
    };

    expect(identitySessionContract.safeParse(session).success).toBe(true);
  });
});
