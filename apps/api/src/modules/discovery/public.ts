import type {
  DiscoveryFeedPageV1,
  FollowingFeedPageV1,
  PublicFollowerCountV1,
  StoreFollowViewV1,
  ViewerStoreFollowV1,
} from "@sevo/contracts/discovery/v1";
import type { IdentityId, StoreId } from "@sevo/contracts/platform/v1";

export const STORE_FOLLOWING = Symbol("STORE_FOLLOWING");
export const STORE_FOLLOW_REPOSITORY = Symbol("STORE_FOLLOW_REPOSITORY");

export type DiscoveryFeedProjectionCandidate = Readonly<{
  productId: string;
  storeId: string;
  firstPublishedAt: Date;
  eligibleSince: Date;
  storePublicationVersion: number;
  publicationVersion: number;
  offerVersion: number;
  availabilityVersion: number;
}>;

export type FollowingFeedRankingKey = Readonly<{
  publicationDayUtc: string;
  storeOrdinal: number;
  storeId: string;
  firstPublishedAt: string;
  productId: string;
}>;

export type RankedFollowingFeedCandidate = Readonly<{
  candidate: DiscoveryFeedProjectionCandidate;
  key: FollowingFeedRankingKey;
}>;

export interface DiscoveryFeedRepository {
  readPublicSnapshot(snapshotAt: Date): Promise<{
    healthy: boolean;
    reason?: string;
    projectionUpdatedAt: Date;
    candidates: DiscoveryFeedProjectionCandidate[];
  }>;
}

export interface DiscoveryFeed {
  read(input: { cursor?: string; limit?: number }): Promise<{
    page: DiscoveryFeedPageV1;
    projectionLagMs: number;
  }>;
}

export interface FollowingFeedRepository {
  readFollowingSnapshot(
    identityId: IdentityId,
    snapshotAt: Date,
    page: { seek?: FollowingFeedRankingKey; limit: number },
  ): Promise<{
    healthy: boolean;
    reason?: string;
    projectionUpdatedAt: Date;
    followSetRevision: number;
    visibleFollowedStoreCount: number;
    candidates: RankedFollowingFeedCandidate[];
  }>;
}

export interface FollowingFeed {
  read(input: {
    identityId: IdentityId;
    cursor?: string;
    limit?: number;
  }): Promise<{ page: FollowingFeedPageV1; projectionLagMs: number }>;
}

export class DiscoveryProjectionUnavailableError extends Error {}

export type StoreFollowOperation = "ACTIVATE" | "DEACTIVATE";

export type StoreFollowWrite = Readonly<{
  operation: StoreFollowOperation;
  identityId: IdentityId;
  storeId: StoreId;
  idempotencyKey: string;
  expectedRevision?: number;
  correlationId: string;
}>;

export type StoredFollowWriteResult = Readonly<{
  view: StoreFollowViewV1;
  etag: string;
}>;

export interface StoreFollowRepository {
  write(command: StoreFollowWrite): Promise<StoredFollowWriteResult>;
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

export interface StoreFollowing {
  activate(
    command: Omit<StoreFollowWrite, "operation">,
  ): Promise<StoredFollowWriteResult>;
  deactivate(
    command: Omit<StoreFollowWrite, "operation">,
  ): Promise<StoredFollowWriteResult>;
}

export class FollowPreconditionRequiredError extends Error {}

export class FollowRevisionConflictError extends Error {
  constructor(readonly currentRevision: number) {
    super("Store-follow revision does not match the current revision");
  }
}

export class FollowIdempotencyConflictError extends Error {}
export class SelfFollowNotAllowedError extends Error {}
export class FollowStoreNotFoundError extends Error {}
