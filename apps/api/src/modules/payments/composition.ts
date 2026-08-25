import { DynamicModule, Module } from "@nestjs/common";
import type { RuntimeEnvironment } from "@sevo/config";

import type { InventoryAuthoring } from "../inventory/public";
import { DirectPaymentApplicationService } from "./application/direct-payment.service";
import { PostgresDirectPaymentRepository } from "./infrastructure/postgres-direct-payment.repository";
import { PaymentController } from "./payment.controller";
import {
  DIRECT_PAYMENT_PROVIDER,
  DIRECT_PAYMENT_REPOSITORY,
  DIRECT_PAYMENT_SERVICE,
  SELLER_STORE_RESOLVER,
} from "./payments.tokens";
import type { DirectPaymentProvider, DirectPaymentRepository } from "./public";
import { DevDirectPaymentProvider } from "./testing/dev-direct-payment-provider";

@Module({})
export class PaymentsModule {
  static register(
    environment: RuntimeEnvironment,
    options: {
      inventory: InventoryAuthoring;
      provider?: DirectPaymentProvider;
      resolveSellerStore: (identityId: string) => Promise<string | undefined>;
    },
  ): DynamicModule {
    const provider =
      options.provider ??
      (environment.DIRECT_PAYMENT_PROVIDER === "dev"
        ? new DevDirectPaymentProvider(environment.DEV_PAYMENT_PROVIDER_SIGNING_SECRET)
        : undefined);
    if (!provider) throw new Error("The selected payment provider is not configured");
    return {
      module: PaymentsModule,
      controllers: [PaymentController],
      providers: [
        { provide: "PAYMENTS_RUNTIME_ENVIRONMENT", useValue: environment },
        { provide: DIRECT_PAYMENT_PROVIDER, useValue: provider },
        { provide: SELLER_STORE_RESOLVER, useValue: options.resolveSellerStore },
        {
          provide: DIRECT_PAYMENT_REPOSITORY,
          useValue: new PostgresDirectPaymentRepository(
            environment.DATABASE_URL,
            options.inventory,
          ),
        },
        {
          provide: DIRECT_PAYMENT_SERVICE,
          inject: [DIRECT_PAYMENT_REPOSITORY, DIRECT_PAYMENT_PROVIDER],
          useFactory: (
            repository: DirectPaymentRepository,
            selectedProvider: DirectPaymentProvider,
          ) => new DirectPaymentApplicationService(repository, selectedProvider),
        },
      ],
    };
  }
}

export { PostgresDirectPaymentRepository } from "./infrastructure/postgres-direct-payment.repository";
