import type {
  DirectPaymentAttempt,
  SellerActionableOrder,
} from "@sevo/contracts/payments/v1";
import type { MoneyV1 } from "@sevo/contracts/platform/v1";

export type DirectPaymentProviderInitiation = Readonly<{
  providerReference: string;
  redirectUrl: string;
}>;

export type VerifiedProviderCallback = Readonly<{
  attemptId: string;
  orderId: string;
  amount: number;
  result: "CONFIRMED";
  providerEventId: string;
  providerReference: string;
}>;

export interface DirectPaymentProvider {
  initiate(command: {
    attemptId: string;
    orderId: string;
    amount: MoneyV1;
  }): Promise<DirectPaymentProviderInitiation>;
  verifyAndMapCallback(rawInput: unknown): Promise<VerifiedProviderCallback>;
}

export interface DirectPaymentService {
  createAttempt(command: {
    identityId: string;
    orderId: string;
    idempotencyKey: string;
    correlationId: string;
  }): Promise<DirectPaymentAttempt>;
  applyCallback(
    input: unknown,
    correlationId: string,
  ): Promise<{ attemptId: string; status: "CONFIRMED"; duplicate: boolean }>;
  readAttempt(identityId: string, attemptId: string): Promise<DirectPaymentAttempt>;
  listSellerActionable(storeId: string): Promise<SellerActionableOrder[]>;
}

export interface DirectPaymentRepository {
  prepareAttempt(command: {
    identityId: string;
    orderId: string;
    attemptId: string;
    idempotencyKey: string;
    requestHash: string;
    correlationId: string;
    leaseUntil: Date;
  }): Promise<DirectPaymentAttempt>;
  recordInitiation(command: {
    attemptId: string;
    providerReference: string;
    redirectUrl: string;
  }): Promise<DirectPaymentAttempt>;
  confirmCallback(
    callback: VerifiedProviderCallback,
    correlationId: string,
  ): Promise<{ attemptId: string; status: "CONFIRMED"; duplicate: boolean }>;
  readAttemptForBuyer(
    identityId: string,
    attemptId: string,
  ): Promise<DirectPaymentAttempt | undefined>;
  listActionableByStore(storeId: string): Promise<SellerActionableOrder[]>;
}

export class InvalidProviderCallbackError extends Error {}
export class DirectPaymentOrderNotPayableError extends Error {}
export class DirectPaymentAmountMismatchError extends Error {}
export class DirectPaymentIdempotencyConflictError extends Error {}
export class DirectPaymentAttemptNotFoundError extends Error {}
