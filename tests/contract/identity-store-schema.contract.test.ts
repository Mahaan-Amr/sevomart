import {
  identityStoreContractExamples,
  identityStoreContractSchemas,
} from "@sevo/contracts";
import { describe, expect, it } from "vitest";

describe("identity and store shared schemas", () => {
  it("accepts every published Persian request and response example", () => {
    for (const [schemaName, example] of Object.entries(identityStoreContractExamples)) {
      expect(
        identityStoreContractSchemas[schemaName].safeParse(example),
        `${schemaName} example must satisfy its shared schema`,
      ).toMatchObject({ success: true });
    }
  });

  it("rejects a non-Iranian mobile number and malformed store slug", () => {
    expect(
      identityStoreContractSchemas.OtpRequest.safeParse({ mobile: "12345" }).success,
    ).toBe(false);
    expect(
      identityStoreContractSchemas.StoreDraftInput.safeParse({
        ...identityStoreContractExamples.StoreDraftInput,
        slug: "فروشگاه من",
      }).success,
    ).toBe(false);
  });
});
