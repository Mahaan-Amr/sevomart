import type { RuntimeEnvironment } from "@sevo/config";

import type { CheckoutRepository } from "../public";

export class CheckoutExpiryRunner {
  private timer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly repository: CheckoutRepository,
    private readonly environment: RuntimeEnvironment,
  ) {}

  async onModuleInit() {
    if (this.environment.NODE_ENV === "test" || !this.repository.expirePendingOrders) {
      return;
    }
    await this.repository.expirePendingOrders(new Date());
    this.timer = setInterval(() => {
      void this.repository.expirePendingOrders?.(new Date()).catch((error: unknown) => {
        console.error(
          JSON.stringify({
            level: "error",
            message: "checkout_expiry_sweep_failed",
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
