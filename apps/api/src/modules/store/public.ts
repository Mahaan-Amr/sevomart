import type { StoreAuthoritativeSnapshotV1, StoreSlug } from "@sevo/contracts/store/v1";
import type {
  PublicFollowerCountV1,
  ViewerStoreFollowV1,
} from "@sevo/contracts/discovery/v1";
import type { IdentityId, StoreId } from "@sevo/contracts/platform/v1";

export const STORE_AUTHORITATIVE_READ = Symbol("STORE_AUTHORITATIVE_READ");

export interface PublicStoreFollowingReader {
  readPublicStoreFollowing(
    storeId: StoreId,
    viewerIdentityId?: IdentityId,
    fallbackUpdatedAt?: string,
  ): Promise<{
    followerCount: PublicFollowerCountV1;
    viewer?: ViewerStoreFollowV1;
    etag?: string;
  }>;
}

export interface PublicActiveProductCountReader {
  readActiveProductCount(storeId: StoreId): Promise<number>;
}

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
  id: string;
  revision: number;
  code: "NATIONAL_POST" | "COURIER" | "PICKUP";
  label: string;
  fixedFeeAmount: number;
  currency: "IRR";
  estimatedDeliveryText: string;
  enabled: boolean;
  requiresDeliveryAddress: boolean;
  requiresPostalCode: boolean;
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
  publicationVersion?: number;
  revision?: number;
  returnPolicyRevision?: number;
  updatedAt: Date;
};

export type StoreWriteContext = {
  operation: "SAVE_STORE_DRAFT" | "PUBLISH_STORE";
  actorId: string;
  correlationId: string;
  idempotencyKey: string;
  requestHash: string;
  compatibleRequestHashes?: readonly string[];
  expectedRevision: number;
  policyChanged?: boolean;
};

export interface StoreRepository {
  readWriteResult(context: StoreWriteContext): Promise<StoreRow | undefined>;
  findById(id: string): Promise<StoreRow | undefined>;
  findByIdInTransaction?(
    transaction: OpaqueStoreTransactionContext,
    id: string,
  ): Promise<StoreRow | undefined>;
  findBySellerId(sellerId: string): Promise<StoreRow | undefined>;
  findBySlug(slug: string): Promise<StoreRow | undefined>;
  isMediaPublished(mediaId: string): Promise<boolean>;
  saveDraft(row: StoreRow, context: StoreWriteContext): Promise<StoreRow>;
  publish(id: string, publishedAt: Date, context: StoreWriteContext): Promise<StoreRow>;
}

export class StoreRevisionConflictError extends Error {
  readonly code = "STORE_REVISION_CONFLICT" as const;

  constructor(
    readonly expectedRevision: number,
    readonly currentRevision: number,
  ) {
    super("Store revision does not match the expected revision");
  }
}

export class StoreSlugConflictError extends Error {
  constructor(readonly slug: string) {
    super("Store slug is already in use");
  }
}

export class StoreIdempotencyConflictError extends Error {
  readonly code = "IDEMPOTENCY_CONFLICT" as const;

  constructor(readonly idempotencyKey: string) {
    super("Idempotency key was already used with another payload");
  }
}

export class StoreOwnershipRequiredError extends Error {
  readonly code = "STORE_OWNERSHIP_REQUIRED" as const;

  constructor(readonly storeId: StoreId) {
    super("Store does not belong to the acting identity");
  }
}

export class StoreNotSellableError extends Error {
  readonly code = "STORE_NOT_SELLABLE" as const;

  constructor(readonly storeId: StoreId) {
    super("Store is not published and sellable");
  }
}

export interface StoreAuthoritativeRead {
  // Internal owner-aware reads, never a public HTTP response. sellerAccess is
  // a live identity-access observation, not part of the Store revision.
  readOwnedStore(
    identityId: IdentityId,
  ): Promise<StoreAuthoritativeSnapshotV1 | undefined>;
  readPublishedStoreBySlug(
    slug: StoreSlug,
  ): Promise<StoreAuthoritativeSnapshotV1 | undefined>;
  readStore(storeId: StoreId): Promise<StoreAuthoritativeSnapshotV1 | undefined>;
  readStoreInTransaction?(
    transaction: OpaqueStoreTransactionContext,
    storeId: StoreId,
  ): Promise<StoreAuthoritativeSnapshotV1 | undefined>;
  requireOwnership(
    identityId: IdentityId,
    storeId: StoreId,
  ): Promise<StoreAuthoritativeSnapshotV1>;
  // These methods check Store-owned publication/settlement invariants only.
  // Acting-identity authorization remains the caller's SellerAccessRead check.
  requireSellable(storeId: StoreId): Promise<StoreAuthoritativeSnapshotV1>;
  requireOwnedSellable(
    identityId: IdentityId,
    storeId: StoreId,
  ): Promise<StoreAuthoritativeSnapshotV1>;
}

export type OpaqueStoreTransactionContext = Readonly<{
  kind: "opaque-store-transaction";
}>;

export interface ApprovedSellerStoreProvisioner {
  provisionApprovedSellerStore(command: {
    identityId: IdentityId;
    proposedStoreName: string;
    idempotencyKey: string;
    correlationId: string;
    transactionContext: OpaqueStoreTransactionContext;
  }): Promise<{ storeId: StoreId; revision: number }>;
}

export type PublicStoreLookup = Readonly<{
  slug: StoreSlug;
}>;
