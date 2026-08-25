import { createHash, randomUUID } from "node:crypto";

import { paymentAttemptIdContract } from "@sevo/contracts/platform/v1";

import type {
  DirectPaymentProvider,
  DirectPaymentRepository,
  DirectPaymentService,
} from "../public";
import { DirectPaymentAttemptNotFoundError } from "../public";
import { DirectPaymentDispatchInProgressError } from "../public";

const PAYMENT_HOLD_MS = 2 * 60 * 1_000;

export class DirectPaymentApplicationService implements DirectPaymentService {
  constructor(
    private readonly repository: DirectPaymentRepository,
    private readonly provider: DirectPaymentProvider,
  ) {}

  async createAttempt(command: Parameters<DirectPaymentService["createAttempt"]>[0]) {
    const attempt = await this.repository.prepareAttempt({
      ...command,
      attemptId: paymentAttemptIdContract.parse(randomUUID()),
      requestHash: createHash("sha256")
        .update(JSON.stringify({ orderId: command.orderId }))
        .digest("hex"),
      leaseUntil: new Date(Date.now() + PAYMENT_HOLD_MS),
    });
    if (attempt.redirectUrl) return attempt;
    if (attempt.status === "REVIEW_REQUIRED") return attempt;
    const claimed = await this.repository.claimDispatch(
      attempt.attemptId,
      command.correlationId,
    );
    if (!claimed) {
      throw new DirectPaymentDispatchInProgressError();
    }
    const initiation = await this.provider.initiate({
      attemptId: attempt.attemptId,
      orderId: attempt.orderId,
      amount: attempt.amount,
    });
    return this.repository.recordInitiation({
      attemptId: attempt.attemptId,
      ...initiation,
    });
  }

  async applyCallback(input: unknown, correlationId: string) {
    let callback = await this.provider.verifyAndMapCallback(input);
    if (callback.result === "PENDING") {
      callback = await this.provider.query({
        attemptId: callback.attemptId,
        orderId: callback.orderId,
        amount: { amount: callback.amount, currency: "IRR" },
        providerReference: callback.providerReference,
      });
    }
    if (callback.result !== "CONFIRMED") {
      throw new Error("Payment was not confirmed by the provider");
    }
    return this.repository.confirmCallback(callback, correlationId);
  }

  async readAttempt(
    identityId: Parameters<DirectPaymentService["readAttempt"]>[0],
    attemptId: Parameters<DirectPaymentService["readAttempt"]>[1],
  ) {
    const attempt = await this.repository.readAttemptForBuyer(identityId, attemptId);
    if (!attempt) throw new DirectPaymentAttemptNotFoundError();
    return attempt;
  }
}
