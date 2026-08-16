import { randomUUID } from "node:crypto";

import type { IranianMobile, OtpCode } from "@sevo/contracts/identity-access/v1";
import { describe, expect, it } from "vitest";

import type { OtpProvider } from "../../apps/api/src/modules/identity-access/public";

export function runOtpProviderContract(
  adapterName: string,
  createProvider: () => OtpProvider,
): void {
  describe(`${adapterName} OTP provider contract`, () => {
    it("acknowledges delivery without exposing the OTP code", async () => {
      const receipt = await createProvider().deliverOtp({
        mobile: "09123456789" as IranianMobile,
        code: "111111" as OtpCode,
        expiresAt: new Date("2026-08-16T12:00:00.000Z"),
        correlationId: randomUUID(),
      });

      expect(receipt.providerReference).toMatch(/^dev-otp:/);
      expect(receipt.providerReference).not.toContain("111111");
      expect(receipt.providerReference).not.toContain("09123456789");
    });
  });
}
