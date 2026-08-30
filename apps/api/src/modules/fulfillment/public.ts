import type {
  AdvanceFulfillmentInput,
  FulfillmentOrderSnapshot,
  FulfillmentOrderSnapshotInput,
  FulfillmentStatus,
  FulfillmentTimeline,
} from "@sevo/contracts/fulfillment/v1";
import type { IdentityId, OrderId, StoreId } from "@sevo/contracts/platform/v1";

export type FulfillmentRequest = Readonly<{
  sessionToken?: string;
  correlationId: string;
}>;

export interface FulfillmentSessionRead {
  readActiveIdentitySession(
    token: string,
  ): Promise<{ identityId: IdentityId } | undefined>;
}

export interface FulfillmentSellerAccessRead {
  isActiveSeller(identityId: IdentityId): Promise<boolean>;
}

export interface FulfillmentStoreResolver {
  resolveStore(identityId: IdentityId): Promise<StoreId | undefined>;
}

export interface FulfillmentOrderAccess {
  sellerCanFulfill(
    actorId: IdentityId,
    storeId: StoreId,
    orderId: OrderId,
  ): Promise<boolean>;
  buyerCanTrack(actorId: IdentityId, orderId: OrderId): Promise<boolean>;
}

export type AdvanceFulfillmentCommand = Readonly<{
  orderId: OrderId;
  actorId: IdentityId;
  storeId: StoreId;
  correlationId: string;
  causationId: string;
  occurredAt: Date;
  idempotencyKey: string;
  requestHash: string;
  expectedStatus: FulfillmentStatus;
  input: AdvanceFulfillmentInput;
}>;

export interface FulfillmentRepository {
  read(orderId: OrderId): Promise<FulfillmentTimeline | undefined>;
  readOrderSnapshot(orderId: OrderId): Promise<
    | Readonly<{
        storeId: StoreId;
        status: "SHIPPED" | "DELIVERED";
        shippedAt: string;
        deliveredAt?: string;
      }>
    | undefined
  >;
  replayAdvance(command: {
    orderId: OrderId;
    actorId: IdentityId;
    idempotencyKey: string;
    requestHash: string;
  }): Promise<FulfillmentTimeline | undefined>;
  advance(command: AdvanceFulfillmentCommand): Promise<FulfillmentTimeline>;
}

export const FULFILLMENT_SERVICE = Symbol("FULFILLMENT_SERVICE");
export const FULFILLMENT_AUTHORITATIVE_READ = Symbol("FULFILLMENT_AUTHORITATIVE_READ");

export interface FulfillmentAuthoritativeRead {
  readOrderSnapshot(
    input: FulfillmentOrderSnapshotInput,
  ): Promise<FulfillmentOrderSnapshot | undefined>;
}

export type FulfillmentFaultCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "FULFILLMENT_NOT_FOUND"
  | "INVALID_TRANSITION"
  | "IDEMPOTENCY_CONFLICT"
  | "IDEMPOTENCY_IN_PROGRESS"
  | "PRECONDITION_REQUIRED"
  | "VALIDATION_ERROR";

export class FulfillmentFault extends Error {
  constructor(readonly code: FulfillmentFaultCode) {
    super(code);
  }
}
