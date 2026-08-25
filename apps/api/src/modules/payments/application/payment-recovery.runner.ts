import { randomUUID } from "node:crypto";

import type { DirectPaymentRepository, DirectPaymentService } from "../public";

export class PaymentRecoveryRunner {
  constructor(
    private readonly repository: DirectPaymentRepository,
    private readonly service: DirectPaymentService,
  ) {}

  async runOnce(now = new Date()) {
    const recovered = await this.repository.recoverExpiredAttempts(now, randomUUID());
    const reconciliationClaimed = await this.service.reconcileNext(now, randomUUID());
    return { recovered, reconciliationClaimed };
  }
}
