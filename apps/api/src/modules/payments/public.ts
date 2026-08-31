import type {
  DirectPaymentAttempt,
  DirectRefund,
  RecordDirectRefundResultInput,
  RequestDirectRefundInput,
  PaymentReviewDetail,
  PaymentReviewItem,
} from "@sevo/contracts/payments/v1";
import type {
  IdentityId,
  MoneyV1,
  OrderId,
  PaymentAttemptId,
  StoreId,
} from "@sevo/contracts/platform/v1";

export type DirectRefundRequest = Readonly<{
  sessionToken?: string;
  correlationId: string;
}>;

export interface DirectRefundSessionRead {
  readActiveIdentitySession(
    token: string,
  ): Promise<{ identityId: IdentityId } | undefined>;
}

export interface DirectRefundSellerAccess {
  isActiveSeller(identityId: IdentityId): Promise<boolean>;
}

export interface DirectRefundStoreResolver {
  resolveStore(identityId: IdentityId): Promise<StoreId | undefined>;
}

export type DirectRefundCommandBase = Readonly<{
  orderId: OrderId;
  actorId: IdentityId;
  storeId: StoreId;
  idempotencyKey: string;
  requestHash: string;
  correlationId: string;
  causationId: string;
  occurredAt: Date;
}>;

export interface DirectRefundRepository {
  request(
    command: DirectRefundCommandBase & { input: RequestDirectRefundInput },
  ): Promise<DirectRefund>;
  readForSeller(storeId: StoreId, orderId: OrderId): Promise<DirectRefund | undefined>;
  recordResult(
    command: Readonly<{
      orderId: OrderId;
      input: RecordDirectRefundResultInput;
      providerKey: string;
      providerEventId: string;
      idempotencyKey: string;
      requestHash: string;
      correlationId: string;
      causationId: string;
      occurredAt: Date;
    }>,
  ): Promise<DirectRefund>;
  onModuleDestroy?(): Promise<void>;
}

export interface DirectRefundService {
  request(
    request: DirectRefundRequest,
    orderId: unknown,
    input: unknown,
    idempotencyKey: unknown,
  ): Promise<DirectRefund>;
  read(request: DirectRefundRequest, orderId: unknown): Promise<DirectRefund>;
  applyProviderResult(
    provider: string,
    input: unknown,
    idempotencyKey: unknown,
    correlationId: string,
  ): Promise<DirectRefund>;
}

export type VerifiedProviderRefundResult = Readonly<{
  orderId: OrderId;
  paymentAttemptId: PaymentAttemptId;
  amount: MoneyV1;
  result: "CONFIRMED" | "FAILED";
  evidenceReference: string;
  providerEventId: string;
}>;

export type DirectRefundFaultCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "REFUND_NOT_FOUND"
  | "CANCELLATION_NOT_ALLOWED"
  | "INVALID_REFUND_TRANSITION"
  | "REFUND_AMOUNT_MISMATCH"
  | "REFUND_EVIDENCE_REQUIRED"
  | "DUPLICATE_RESULT"
  | "IDEMPOTENCY_CONFLICT"
  | "IDEMPOTENCY_IN_PROGRESS"
  | "PRECONDITION_REQUIRED"
  | "VALIDATION_ERROR";

export class DirectRefundFault extends Error {
  constructor(readonly code: DirectRefundFaultCode) {
    super(code);
  }
}

export type DirectPaymentProviderInitiation = Readonly<{
  providerReference: string;
  redirectUrl: string;
}>;

export type VerifiedProviderCallback = Readonly<{
  attemptId: PaymentAttemptId;
  orderId: OrderId;
  amount: number;
  result: "CONFIRMED" | "FAILED" | "PENDING";
  providerEventId: string;
  providerReference: string;
}>;

export interface DirectPaymentProvider {
  readonly providerKey: string;
  initiate(command: {
    attemptId: PaymentAttemptId;
    orderId: OrderId;
    amount: MoneyV1;
  }): Promise<DirectPaymentProviderInitiation>;
  verifyAndMapCallback(rawInput: unknown): Promise<VerifiedProviderCallback>;
  query(command: {
    attemptId: PaymentAttemptId;
    orderId: OrderId;
    amount: MoneyV1;
    providerReference: string;
  }): Promise<VerifiedProviderCallback>;
  verifyAndMapRefundResult(rawInput: unknown): Promise<VerifiedProviderRefundResult>;
}

export interface DirectPaymentService {
  createAttempt(command: {
    identityId: IdentityId;
    orderId: OrderId;
    idempotencyKey: string;
    correlationId: string;
  }): Promise<DirectPaymentAttempt>;
  applyCallback(
    input: unknown,
    correlationId: string,
  ): Promise<{
    attemptId: PaymentAttemptId;
    status: "CONFIRMED" | "FAILED" | "REVIEW_REQUIRED";
    duplicate: boolean;
  }>;
  readAttempt(
    identityId: IdentityId,
    attemptId: PaymentAttemptId,
  ): Promise<DirectPaymentAttempt>;
  reconcileNext(now: Date, correlationId: string): Promise<boolean>;
  listReviewRequired(): Promise<readonly PaymentReviewItem[]>;
  revealReview(command: PaymentReviewAccessCommand): Promise<PaymentReviewDetail>;
  requestReconciliation(
    command: Omit<PaymentReviewAccessCommand, "grantId">,
  ): Promise<{ reviewId: PaymentAttemptId; requestedAt: string }>;
}

export type PaymentReviewAccessCommand = Readonly<{
  reviewId: PaymentAttemptId;
  actorIdentityId: string;
  grantId: string;
  reason: string;
  correlationId: string;
}>;

export type DirectPaymentReconciliation = Readonly<{
  attemptId: PaymentAttemptId;
  orderId: OrderId;
  amount: MoneyV1;
  providerReference?: string;
}>;

export interface DirectPaymentRepository {
  prepareAttempt(command: {
    identityId: IdentityId;
    orderId: OrderId;
    attemptId: PaymentAttemptId;
    idempotencyKey: string;
    requestHash: string;
    correlationId: string;
    leaseUntil: Date;
  }): Promise<DirectPaymentAttempt>;
  recordInitiation(command: {
    attemptId: PaymentAttemptId;
    providerReference: string;
    redirectUrl: string;
    correlationId: string;
  }): Promise<DirectPaymentAttempt>;
  claimDispatch(attemptId: PaymentAttemptId, correlationId: string): Promise<boolean>;
  applyProviderResult(
    callback: VerifiedProviderCallback,
    correlationId: string,
  ): Promise<{
    attemptId: PaymentAttemptId;
    status: "CONFIRMED" | "FAILED" | "REVIEW_REQUIRED";
    duplicate: boolean;
  }>;
  readAttemptForBuyer(
    identityId: IdentityId,
    attemptId: PaymentAttemptId,
  ): Promise<DirectPaymentAttempt | undefined>;
  recoverExpiredAttempts(now: Date, correlationId: string): Promise<number>;
  markDispatchUnknown(
    attemptId: PaymentAttemptId,
    correlationId: string,
  ): Promise<DirectPaymentAttempt>;
  claimNextReconciliation(
    now: Date,
    correlationId: string,
  ): Promise<DirectPaymentReconciliation | null>;
  listReviewRequired(): Promise<readonly PaymentReviewItem[]>;
  revealReview(command: PaymentReviewAccessCommand): Promise<PaymentReviewDetail>;
  requestReconciliation(
    command: Omit<PaymentReviewAccessCommand, "grantId">,
  ): Promise<{ reviewId: PaymentAttemptId; requestedAt: string }>;
}

export class InvalidProviderCallbackError extends Error {}
export class DirectPaymentOrderNotPayableError extends Error {}
export class DirectPaymentAmountMismatchError extends Error {}
export class DirectPaymentIdempotencyConflictError extends Error {}
export class DirectPaymentAttemptNotFoundError extends Error {}
export class DirectPaymentDispatchInProgressError extends Error {}
export class PaymentReviewNotFoundError extends Error {}
export class PaymentReconciliationNotAvailableError extends Error {}
