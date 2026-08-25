import { createHash, randomUUID } from "node:crypto";

import { paymentAttemptIdContract } from "@sevo/contracts/platform/v1";

import type {
  DirectPaymentProvider,
  DirectPaymentRepository,
  DirectPaymentService,
} from "../public";
import { DirectPaymentAttemptNotFoundError } from "../public";

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
    const callback = await this.provider.verifyAndMapCallback(input);
    return this.repository.confirmCallback(callback, correlationId);
  }

  async readAttempt(identityId: string, attemptId: string) {
    const attempt = await this.repository.readAttemptForBuyer(identityId, attemptId);
    if (!attempt) throw new DirectPaymentAttemptNotFoundError();
    return attempt;
  }

  listSellerActionable(storeId: string) {
    return this.repository.listActionableByStore(storeId);
  }
}
