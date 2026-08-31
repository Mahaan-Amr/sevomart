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
    try {
      const initiation = await this.provider.initiate({
        attemptId: attempt.attemptId,
        orderId: attempt.orderId,
        amount: attempt.amount,
      });
      return this.repository.recordInitiation({
        attemptId: attempt.attemptId,
        ...initiation,
        correlationId: command.correlationId,
      });
    } catch {
      return this.repository.markDispatchUnknown(
        attempt.attemptId,
        command.correlationId,
      );
    }
  }

  async applyCallback(input: unknown, correlationId: string) {
    const callback = await this.provider.verifyAndMapCallback(input);
    return this.repository.applyProviderResult(callback, correlationId);
  }

  async readAttempt(
    identityId: Parameters<DirectPaymentService["readAttempt"]>[0],
    attemptId: Parameters<DirectPaymentService["readAttempt"]>[1],
  ) {
    const attempt = await this.repository.readAttemptForBuyer(identityId, attemptId);
    if (!attempt) throw new DirectPaymentAttemptNotFoundError();
    return attempt;
  }

  async reconcileNext(now: Date, correlationId: string) {
    const reconciliation = await this.repository.claimNextReconciliation(
      now,
      correlationId,
    );
    if (!reconciliation) return false;
    try {
      if (!reconciliation.providerReference) {
        const initiation = await this.provider.initiate({
          attemptId: reconciliation.attemptId,
          orderId: reconciliation.orderId,
          amount: reconciliation.amount,
        });
        await this.repository.recordInitiation({
          attemptId: reconciliation.attemptId,
          ...initiation,
          correlationId,
        });
        return true;
      }
      const result = await this.provider.query({
        ...reconciliation,
        providerReference: reconciliation.providerReference,
      });
      await this.repository.applyProviderResult(result, correlationId);
    } catch {
      // The claimed row already carries its durable next retry timestamp.
    }
    return true;
  }

  listReviewRequiredV2() {
    return this.repository.listReviewRequiredV2();
  }

  revealReview(command: Parameters<DirectPaymentService["revealReview"]>[0]) {
    return this.repository.revealReview(command);
  }

  requestReconciliation(
    command: Parameters<DirectPaymentService["requestReconciliation"]>[0],
  ) {
    return this.repository.requestReconciliation(command);
  }
}
