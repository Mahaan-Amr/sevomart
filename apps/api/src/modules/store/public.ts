export type SettlementDestination = {
  kind: "TEST";
};

export type VerifiedSettlementDestination = SettlementDestination & {
  status: "TEST_VERIFIED";
  verifiedAt: Date;
};

export interface SettlementDestinationVerifier {
  verify(destination: SettlementDestination): Promise<VerifiedSettlementDestination>;
}
