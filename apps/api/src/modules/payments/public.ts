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
    status: "CONFIRMED";
    duplicate: boolean;
  }>;
  readAttempt(
    identityId: IdentityId,
    attemptId: PaymentAttemptId,
  ): Promise<DirectPaymentAttempt>;
}

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
  confirmCallback(
    callback: VerifiedProviderCallback,
    correlationId: string,
  ): Promise<{
    attemptId: PaymentAttemptId;
    status: "CONFIRMED";
    duplicate: boolean;
  }>;
  readAttemptForBuyer(
    identityId: IdentityId,
    attemptId: PaymentAttemptId,
  ): Promise<DirectPaymentAttempt | undefined>;
  recoverExpiredDispatches(now: Date): Promise<number>;
}

export class InvalidProviderCallbackError extends Error {}
export class DirectPaymentOrderNotPayableError extends Error {}
export class DirectPaymentAmountMismatchError extends Error {}
export class DirectPaymentIdempotencyConflictError extends Error {}
export class DirectPaymentAttemptNotFoundError extends Error {}
export class DirectPaymentDispatchInProgressError extends Error {}
