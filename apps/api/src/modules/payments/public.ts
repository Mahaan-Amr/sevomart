import type { DirectPaymentAttempt } from "@sevo/contracts/payments/v1";
import type {
  IdentityId,
  MoneyV1,
  OrderId,
  PaymentAttemptId,
} from "@sevo/contracts/platform/v1";

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
}

export type DirectPaymentReconciliation = Readonly<{
  attemptId: PaymentAttemptId;
  orderId: OrderId;
  amount: MoneyV1;
  providerReference: string;
}>;

export type PaymentReviewItem = Readonly<{
  attempt: DirectPaymentAttempt;
  orderStatus: "PAYMENT_REVIEW";
  audits: ReadonlyArray<{
    fromStatus: string | null;
    toStatus: string;
    reasonCode: string;
    correlationId: string;
    occurredAt: string;
  }>;
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
  claimNextReconciliation(now: Date): Promise<DirectPaymentReconciliation | null>;
  listReviewRequired(): Promise<readonly PaymentReviewItem[]>;
}

export class InvalidProviderCallbackError extends Error {}
export class DirectPaymentOrderNotPayableError extends Error {}
export class DirectPaymentAmountMismatchError extends Error {}
export class DirectPaymentIdempotencyConflictError extends Error {}
export class DirectPaymentAttemptNotFoundError extends Error {}
export class DirectPaymentDispatchInProgressError extends Error {}
