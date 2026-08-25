import type { RuntimeEnvironment } from "@sevo/config";

import type { DirectPaymentRepository } from "../public";

export class PaymentRecoveryRunner {
  private timer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly repository: DirectPaymentRepository,
    private readonly environment: RuntimeEnvironment,
  ) {}

  async onModuleInit() {
    if (this.environment.NODE_ENV === "test") return;
    await this.repository.recoverExpiredDispatches(new Date());
    this.timer = setInterval(() => {
      void this.repository
        .recoverExpiredDispatches(new Date())
        .catch((error: unknown) => {
          console.error(
            JSON.stringify({
              level: "error",
              message: "payment_dispatch_recovery_failed",
              error: error instanceof Error ? error.message : "unknown_error",
            }),
          );
        });
    }, 30_000);
    this.timer.unref?.();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
}
