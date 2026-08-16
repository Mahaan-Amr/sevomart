import type {
  SettlementDestination,
  SettlementDestinationVerifier,
  VerifiedSettlementDestination,
} from "../public";

export class TestSettlementDestinationVerifier implements SettlementDestinationVerifier {
  async verify(
    destination: SettlementDestination,
  ): Promise<VerifiedSettlementDestination> {
    return {
      ...destination,
      status: "TEST_VERIFIED",
      verifiedAt: new Date(),
    };
  }
}
