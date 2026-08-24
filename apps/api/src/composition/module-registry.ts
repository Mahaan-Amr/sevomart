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
import { InventoryModule } from "../modules/inventory/composition";
import { MediaModule } from "../modules/media/composition";
import { NotificationsModule } from "../modules/notifications/composition";
import { OrdersModule } from "../modules/orders/composition";
import { PaymentsModule } from "../modules/payments/composition";
import { ProblemFollowUpModule } from "../modules/problem-follow-up/composition";
import { ProductModule } from "../modules/product/composition";
import { ReportingAnalyticsModule } from "../modules/reporting-analytics/composition";
import { PostgresStoreRepository, StoreModule } from "../modules/store/composition";
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

  return [
    IdentityAccessModule.register(environment, { ...identityOptions, otpProvider }),
    MediaModule.register(environment, undefined, (mediaId) =>
      storeRepository.isMediaPublished(mediaId),
    ),
    StoreModule.register(environment, {
      repository: storeRepository,
      publicStoreFollowingReader: storeFollowingRepository,
    }),
    ProductModule,
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
