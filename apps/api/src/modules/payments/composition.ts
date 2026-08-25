import { DynamicModule, Module } from "@nestjs/common";
import type { RuntimeEnvironment } from "@sevo/config";

import type { InventoryAuthoring } from "../inventory/public";
import type { OrderPaymentWorkflow } from "../orders/public";
import type { PlatformAgentSessionAuthorizer } from "../identity-access/public";
import { DirectPaymentApplicationService } from "./application/direct-payment.service";
import { PaymentRecoveryRunner } from "./application/payment-recovery.runner";
import { PostgresDirectPaymentRepository } from "./infrastructure/postgres-direct-payment.repository";
import {
  DevPaymentController,
  InternalPaymentRecoveryController,
  PaymentController,
  PlatformPaymentReviewController,
  ProviderCallbackController,
} from "./payment.controller";
import {
  DIRECT_PAYMENT_PROVIDER,
  DIRECT_PAYMENT_REPOSITORY,
  DIRECT_PAYMENT_SERVICE,
  PAYMENT_REVIEW_AUTHORIZER,
} from "./payments.tokens";
import type {
  DirectPaymentProvider,
  DirectPaymentRepository,
  DirectPaymentService,
} from "./public";
import { DevDirectPaymentProvider } from "./testing/dev-direct-payment-provider";

@Module({})
export class PaymentsModule {
  static register(
    environment: RuntimeEnvironment,
    options: {
      inventory: InventoryAuthoring;
      orders: OrderPaymentWorkflow;
      provider?: DirectPaymentProvider;
      platformAgentSessions: PlatformAgentSessionAuthorizer;
    },
  ): DynamicModule {
    const devProvider =
      !options.provider && environment.SEVO_RUNTIME_ENV !== "production"
        ? new DevDirectPaymentProvider("sevo-local-dev-payment-fixture-secret")
        : undefined;
    const provider = options.provider ?? devProvider;
    if (!provider) throw new Error("The selected payment provider is not configured");
    return {
      module: PaymentsModule,
      controllers: [
        PaymentController,
        ProviderCallbackController,
        InternalPaymentRecoveryController,
        PlatformPaymentReviewController,
        ...(devProvider ? [DevPaymentController] : []),
      ],
      providers: [
        { provide: "PAYMENTS_RUNTIME_ENVIRONMENT", useValue: environment },
        {
          provide: PAYMENT_REVIEW_AUTHORIZER,
          useValue: options.platformAgentSessions,
        },
        { provide: DIRECT_PAYMENT_PROVIDER, useValue: provider },
        {
          provide: DIRECT_PAYMENT_REPOSITORY,
          useValue: new PostgresDirectPaymentRepository(
            environment.DATABASE_URL,
            options.inventory,
            options.orders,
            provider.providerKey,
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
        {
          provide: PaymentRecoveryRunner,
          inject: [DIRECT_PAYMENT_REPOSITORY, DIRECT_PAYMENT_SERVICE],
          useFactory: (
            repository: DirectPaymentRepository,
            service: DirectPaymentService,
          ) => new PaymentRecoveryRunner(repository, service),
        },
      ],
    };
  }
}

export { PostgresDirectPaymentRepository } from "./infrastructure/postgres-direct-payment.repository";
