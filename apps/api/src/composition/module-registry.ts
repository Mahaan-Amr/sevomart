import type { DynamicModule, Type } from "@nestjs/common";
import type { RuntimeEnvironment } from "@sevo/config";

import { ConversationsModule } from "../modules/conversations/composition";
import { ContentModule } from "../modules/content/composition";
import {
  DiscoveryModule,
  PostgresStoreFollowingRepository,
} from "../modules/discovery/composition";
import { FulfillmentModule } from "../modules/fulfillment/composition";
import {
  IdentityAccessModule,
  type IdentityAccessModuleOptions,
} from "../modules/identity-access/composition";
import {
  InventoryModule,
  PostgresInventoryAuthoring,
} from "../modules/inventory/composition";
import { MediaModule } from "../modules/media/composition";
import { NotificationsModule } from "../modules/notifications/composition";
import { OrdersModule } from "../modules/orders/composition";
import { PaymentsModule } from "../modules/payments/composition";
import { ProblemFollowUpModule } from "../modules/problem-follow-up/composition";
import {
  PostgresProductRepository,
  ProductModule,
} from "../modules/product/composition";
import { ReportingAnalyticsModule } from "../modules/reporting-analytics/composition";
import {
  createOpaqueStoreTransactionContext,
  PostgresStoreRepository,
  StoreModule,
} from "../modules/store/composition";
import { DevOtpProvider } from "../modules/notifications/composition";

type NestModule = Type<unknown> | DynamicModule;

export function composeCanonicalApiModules(
  environment: RuntimeEnvironment,
  identityOptions: IdentityAccessModuleOptions = {},
): NestModule[] {
  const otpProvider =
    identityOptions.otpProvider ??
    (environment.OTP_PROVIDER === "dev" ? new DevOtpProvider() : undefined);
  const storeRepository = new PostgresStoreRepository(environment.DATABASE_URL);
  const storeFollowingRepository = new PostgresStoreFollowingRepository(
    environment.DATABASE_URL,
  );
  const inventoryAuthoring = new PostgresInventoryAuthoring(environment.DATABASE_URL);
  const productRepository = new PostgresProductRepository(
    environment.DATABASE_URL,
    inventoryAuthoring,
  );

  return [
    IdentityAccessModule.register(environment, {
      ...identityOptions,
      otpProvider,
      approvedSellerStoreProvisioner:
        identityOptions.approvedSellerStoreProvisioner ?? storeRepository,
      createStoreTransactionContext:
        identityOptions.createStoreTransactionContext ??
        createOpaqueStoreTransactionContext,
    }),
    MediaModule.register(environment, undefined, async (mediaId) => {
      if (await storeRepository.isMediaPublished(mediaId)) return true;
      const storeId = await productRepository.findPublishedMediaStoreId(mediaId);
      if (!storeId) return false;
      return (await storeRepository.findById(storeId))?.status === "PUBLISHED";
    }),
    StoreModule.register(environment, {
      repository: storeRepository,
      publicStoreFollowingReader: storeFollowingRepository,
    }),
    ProductModule.register(environment, { repository: productRepository }),
    InventoryModule,
    OrdersModule,
    PaymentsModule,
    FulfillmentModule,
    ConversationsModule,
    ProblemFollowUpModule,
    ContentModule,
    DiscoveryModule.register(environment, storeFollowingRepository),
    NotificationsModule,
    ReportingAnalyticsModule,
  ];
}
