import type { FulfillmentOrderSnapshot } from "@sevo/contracts/fulfillment/v1";
import type {
  buyerDisputeViewContract,
  platformDisputeQueueContract,
  platformDisputeViewContract,
  platformViolationCaseViewContract,
  platformViolationQueueContract,
  sellerDisputePageContract,
  sellerDisputeViewContract,
} from "@sevo/contracts/problem-follow-up/v1";
import type {
  DisputeId,
  OpenDisputeInputV2,
  ReopenDisputeInputV2,
  ResolveDisputeInputV2,
  RespondToDisputeInputV2,
  ViolationCaseId,
} from "@sevo/contracts/problem-follow-up/v2";
import type { IdentityId, OrderId, StoreId } from "@sevo/contracts/platform/v1";
import type {
  OpaquePlatformAccessTransactionContext,
  PlatformSensitiveAccess,
  PlatformSensitiveAction,
} from "../identity-access/public";

export type ProblemFollowUpRequest = Readonly<{
  sessionToken?: string;
  correlationId: string;
}>;

export interface ProblemFollowUpSessionRead {
  readActiveIdentitySession(
    token: string,
  ): Promise<{ identityId: IdentityId } | undefined>;
}

export interface ProblemFollowUpFulfillmentRead {
  readOrderSnapshot(input: {
    orderId: OrderId;
    buyerId: IdentityId;
  }): Promise<FulfillmentOrderSnapshot | undefined>;
}

export type OpenDisputeInput = OpenDisputeInputV2;
export type BuyerDisputeView = ReturnType<typeof buyerDisputeViewContract.parse>;
export type SellerDisputeView = ReturnType<typeof sellerDisputeViewContract.parse>;
export type SellerDisputePage = ReturnType<typeof sellerDisputePageContract.parse>;
export type PlatformDisputeQueue = ReturnType<
  typeof platformDisputeQueueContract.parse
>;
export type PlatformDisputeView = ReturnType<typeof platformDisputeViewContract.parse>;
export type PlatformViolationQueue = ReturnType<
  typeof platformViolationQueueContract.parse
>;
export type PlatformViolationCaseView = ReturnType<
  typeof platformViolationCaseViewContract.parse
>;
export type RespondToDisputeInput = RespondToDisputeInputV2;
export type ResolveDisputeInput = ResolveDisputeInputV2;
export type ReopenDisputeInput = ReopenDisputeInputV2;

export type OpenDisputeCommand = Readonly<{
  actorId: IdentityId;
  storeId: StoreId;
  input: OpenDisputeInput;
  openedAt: Date;
  sellerResponseDeadline: Date;
  idempotencyKey: string;
  requestHash: string;
  correlationId: string;
}>;

export interface ProblemFollowUpRepository {
  replayOpen(command: {
    actorId: IdentityId;
    idempotencyKey: string;
    requestHash: string;
  }): Promise<BuyerDisputeView | undefined>;
  open(command: OpenDisputeCommand): Promise<BuyerDisputeView>;
  readBuyer(actorId: IdentityId, disputeId: DisputeId): Promise<BuyerDisputeView>;
  listSeller(storeId: StoreId, query: PageQuery): Promise<SellerDisputePage>;
  readSeller(storeId: StoreId, disputeId: DisputeId): Promise<SellerDisputeView>;
  respond(
    command: DisputeMutationCommand<RespondToDisputeInput>,
  ): Promise<SellerDisputeView>;
  listPlatformDisputes(query: PageQuery): Promise<PlatformDisputeQueue>;
  readPlatformDispute(command: SensitiveCaseRead): Promise<PlatformDisputeView>;
  resolve(
    command: SensitiveDisputeMutation<ResolveDisputeInput>,
  ): Promise<PlatformDisputeView>;
  reopen(
    command: SensitiveDisputeMutation<ReopenDisputeInput>,
  ): Promise<PlatformDisputeView>;
  listPlatformViolations(query: PageQuery): Promise<PlatformViolationQueue>;
  readPlatformViolation(command: SensitiveCaseRead): Promise<PlatformViolationCaseView>;
}

export type PageQuery = Readonly<{ cursor?: string; limit: number }>;

export type DisputeMutationCommand<Input> = Readonly<{
  disputeId: DisputeId;
  actorId: IdentityId;
  storeId?: StoreId;
  input: Input;
  occurredAt: Date;
  idempotencyKey: string;
  requestHash: string;
  correlationId: string;
}>;

export type SensitiveAccessInput = Readonly<{
  grantId: string;
  reason: string;
}>;

export type SensitiveCaseRead = Readonly<{
  caseId: DisputeId | ViolationCaseId;
  actorId: IdentityId;
  responsibility: "DISPUTE_REVIEW" | "VIOLATION_REVIEW";
  resourceType: "DISPUTE_CASE" | "VIOLATION_CASE";
  action: "REVEAL_MINIMUM";
  access: SensitiveAccessInput;
  correlationId: string;
}>;

export type SensitiveDisputeMutation<Input> = DisputeMutationCommand<Input> &
  Readonly<{
    access: SensitiveAccessInput;
    responsibility: "DISPUTE_REVIEW";
    action: "UPDATE_CASE_STATUS";
  }>;

export interface ProblemFollowUpSensitiveAccess {
  authorizeSensitiveAction(
    transaction: OpaquePlatformAccessTransactionContext,
    input: PlatformSensitiveAction,
  ): ReturnType<PlatformSensitiveAccess["authorizeSensitiveAction"]>;
}

export interface ProblemFollowUpPlatformSessionRead {
  readWorkspaceSession(token: string): Promise<{
    actor: { identityId: string };
    permissions: string[];
  }>;
}

export interface ProblemFollowUpSellerAccessRead {
  isActiveSeller(identityId: IdentityId): Promise<boolean>;
}

export interface ProblemFollowUpStoreResolver {
  resolveStore(identityId: IdentityId): Promise<StoreId | undefined>;
}

export interface ProblemFollowUpEvidenceRead {
  isReadySellerEvidence(input: {
    identityId: string;
    disputeId: string;
    evidenceId: string;
  }): Promise<boolean>;
}

export type ProblemFollowUpFaultCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "WINDOW_CLOSED"
  | "DEADLINE_PASSED"
  | "INVALID_TRANSITION"
  | "NOT_FOUND"
  | "SENSITIVE_ACCESS_REQUIRED"
  | "IDEMPOTENCY_CONFLICT"
  | "IDEMPOTENCY_IN_PROGRESS"
  | "PRECONDITION_REQUIRED"
  | "VALIDATION_ERROR";

export class ProblemFollowUpFault extends Error {
  constructor(readonly code: ProblemFollowUpFaultCode) {
    super(code);
  }
}

export const PROBLEM_FOLLOW_UP_SERVICE = Symbol("PROBLEM_FOLLOW_UP_SERVICE");
