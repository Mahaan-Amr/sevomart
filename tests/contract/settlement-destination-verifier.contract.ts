import { describe, expect, it } from "vitest";

import type { SettlementDestinationVerifier } from "../../apps/api/src/modules/store/public";

export function runSettlementDestinationVerifierContract(
  adapterName: string,
  createVerifier: () => SettlementDestinationVerifier,
): void {
  describe(`${adapterName} settlement destination verifier contract`, () => {
    it("returns a verified test destination without production bank details", async () => {
      const result = await createVerifier().verify({ kind: "TEST" });

      expect(result).toMatchObject({ kind: "TEST", status: "TEST_VERIFIED" });
      expect(result.verifiedAt).toBeInstanceOf(Date);
      expect(result).not.toHaveProperty("iban");
      expect(result).not.toHaveProperty("cardNumber");
    });
  });
}
