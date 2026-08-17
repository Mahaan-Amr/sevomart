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

export type StoreStatus = "DRAFT" | "PUBLISHED";

export type StoreShippingMethod = {
  code: "NATIONAL_POST" | "COURIER" | "PICKUP";
  label: string;
};

export type StoreRow = {
  id: string;
  sellerId: string;
  name?: string;
  slug?: string;
  bio?: string;
  shippingMethods?: StoreShippingMethod[];
  returnPolicy?: string;
  settlementDestination?: VerifiedSettlementDestination;
  logoMediaId?: string | null;
  coverMediaId?: string | null;
  themeColor?: string;
  status: StoreStatus;
  publishedAt?: Date;
  updatedAt: Date;
};

export interface StoreRepository {
  findBySellerId(sellerId: string): Promise<StoreRow | undefined>;
  findBySlug(slug: string): Promise<StoreRow | undefined>;
  isMediaPublished(mediaId: string): Promise<boolean>;
  saveDraft(row: StoreRow): Promise<StoreRow>;
  publish(id: string, publishedAt: Date): Promise<StoreRow>;
}
