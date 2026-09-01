import { DynamicModule, Module } from "@nestjs/common";
import type { RuntimeEnvironment } from "@sevo/config";

import type { InventoryAuthoring } from "../inventory/public";
import type { FulfillmentRepository } from "../fulfillment/public";
import type { OrderPaymentWorkflow } from "../orders/public";
import {
  IDENTITY_SESSION_READER,
  PLATFORM_SENSITIVE_ACCESS,
  SELLER_ACCESS_READ,
  type IdentitySessionReader,
  type OpaquePlatformAccessTransactionContext,
  type PlatformAgentSessionAuthorizer,
  type PlatformSensitiveAccess,
  type SellerAccessRead,
} from "../identity-access/public";
import type { Sql } from "postgres";
import { identityIdContract, storeIdContract } from "@sevo/contracts/platform/v1";
import { DirectRefundApplicationService } from "./application/direct-refund.service";
import { DirectPaymentApplicationService } from "./application/direct-payment.service";
import { PaymentRecoveryRunner } from "./application/payment-recovery.runner";
import { PostgresDirectPaymentRepository } from "./infrastructure/postgres-direct-payment.repository";
import { PostgresDirectRefundRepository } from "./infrastructure/postgres-direct-refund.repository";
import {
  DevPaymentController,
  DirectRefundController,
  InternalPaymentRecoveryController,
  PaymentController,
  PlatformPaymentReviewController,
  ProviderCallbackController,
} from "./payment.controller";
import {
  DIRECT_PAYMENT_PROVIDER,
  DIRECT_PAYMENT_REPOSITORY,
  DIRECT_PAYMENT_SERVICE,
  DIRECT_REFUND_SERVICE,
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
      createPlatformAccessTransactionContext: (
        transaction: Sql,
      ) => OpaquePlatformAccessTransactionContext;
      fulfillment: FulfillmentRepository;
      resolveSellerStore: (identityId: string) => Promise<string | undefined>;
    },
  ): DynamicModule {
    const devProvider =
      !options.provider && environment.SEVO_RUNTIME_ENV !== "production"
        ? new DevDirectPaymentProvider("sevo-local-dev-payment-fixture-secret")
        : undefined;
    const provider = options.provider ?? devProvider;
    if (!provider) throw new Error("The selected payment provider is not configured");
    const refundRepository = new PostgresDirectRefundRepository(
      environment.DATABASE_URL,
      options.inventory,
      options.orders,
      options.fulfillment,
    );
    return {
      module: PaymentsModule,
      controllers: [
        PaymentController,
        DirectRefundController,
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
          inject: [PLATFORM_SENSITIVE_ACCESS],
          useFactory: (sensitiveAccess: PlatformSensitiveAccess) =>
            new PostgresDirectPaymentRepository(
              environment.DATABASE_URL,
              options.inventory,
              options.orders,
              provider.providerKey,
              sensitiveAccess,
              options.createPlatformAccessTransactionContext,
            ),
        },
        {
          provide: DIRECT_REFUND_SERVICE,
          inject: [IDENTITY_SESSION_READER, SELLER_ACCESS_READ],
          useFactory: (
            sessions: IdentitySessionReader,
            sellerAccess: SellerAccessRead,
          ) =>
            new DirectRefundApplicationService(
              refundRepository,
              {
                async readActiveIdentitySession(token) {
                  const session = await sessions.readActiveIdentitySession(token);
                  return session
                    ? { identityId: identityIdContract.parse(session.actor.identityId) }
                    : undefined;
                },
              },
              sellerAccess,
              {
                async resolveStore(identityId) {
                  const storeId = await options.resolveSellerStore(identityId);
                  return storeId ? storeIdContract.parse(storeId) : undefined;
                },
              },
              provider,
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
export { PostgresDirectRefundRepository } from "./infrastructure/postgres-direct-refund.repository";
