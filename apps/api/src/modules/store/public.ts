export type SettlementDestination = {
  kind: "TEST";
  reference: string;
};

export type VerifiedSettlementDestination = SettlementDestination & {
  status: "TEST_VERIFIED";
  verifiedAt: Date;
};

export interface SettlementDestinationVerifier {
  verify(destination: SettlementDestination): Promise<VerifiedSettlementDestination>;
}
