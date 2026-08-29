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
  PostgresPlatformAgentSessionAuthorizer,
  type IdentityAccessModuleOptions,
} from "../modules/identity-access/composition";
import {
  InventoryModule,
  PostgresInventoryAuthoring,
} from "../modules/inventory/composition";
import type { ConversationMediaAccess } from "../modules/media/public";
import { MediaModule } from "../modules/media/composition";
import { NotificationsModule } from "../modules/notifications/composition";
import {
  OrdersModule,
  PostgresCheckoutRepository,
} from "../modules/orders/composition";
import { PaymentsModule } from "../modules/payments/composition";
import { ProblemFollowUpModule } from "../modules/problem-follow-up/composition";
import {
  createOpaqueProductTransactionContext,
  PostgresProductRepository,
  ProductModule,
} from "../modules/product/composition";
import { ReportingAnalyticsModule } from "../modules/reporting-analytics/composition";
import {
  createOpaqueStoreTransactionContext,
  PostgresStoreRepository,
  StoreService,
  StoreModule,
} from "../modules/store/composition";
import { DevOtpProvider } from "../modules/notifications/composition";

type NestModule = Type<unknown> | DynamicModule;

function createApiCompositionContext(
  environment: RuntimeEnvironment,
  identityOptions: IdentityAccessModuleOptions = {},
) {
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
  const checkoutRepository = new PostgresCheckoutRepository(
    environment.DATABASE_URL,
    inventoryAuthoring,
    productRepository,
    new StoreService(storeRepository, async () => {
      throw new Error("Settlement verification is unavailable in checkout reads");
    }),
    createOpaqueProductTransactionContext,
    createOpaqueStoreTransactionContext,
  );
  const platformAgentSessions = new PostgresPlatformAgentSessionAuthorizer(
    environment.DATABASE_URL,
  );

  let conversationMediaAccess: ConversationMediaAccess = async () => false;
  return {
    authorizeConversationMedia: (input: Parameters<ConversationMediaAccess>[0]) =>
      conversationMediaAccess(input),
    setConversationMediaAccess: (access: ConversationMediaAccess) => {
      conversationMediaAccess = access;
    },
    checkoutRepository,
    environment,
    identityOptions,
    inventoryAuthoring,
    otpProvider,
    platformAgentSessions,
    productRepository,
    storeFollowingRepository,
    storeRepository,
  };
}

type ApiCompositionContext = ReturnType<typeof createApiCompositionContext>;

export const canonicalApiModuleRegistry: readonly {
  owner: string;
  artifact: Type<unknown>;
  compose: (context: ApiCompositionContext) => NestModule;
}[] = [
  {
    owner: "identity-access",
    artifact: IdentityAccessModule,
    compose: ({
      environment,
      identityOptions,
      otpProvider,
      platformAgentSessions,
      storeRepository,
    }) =>
      IdentityAccessModule.register(environment, {
        ...identityOptions,
        otpProvider,
        approvedSellerStoreProvisioner:
          identityOptions.approvedSellerStoreProvisioner ?? storeRepository,
        createStoreTransactionContext:
          identityOptions.createStoreTransactionContext ??
          createOpaqueStoreTransactionContext,
        platformAgentSessionAuthorizer:
          identityOptions.platformAgentSessionAuthorizer ?? platformAgentSessions,
      }),
  },
  {
    owner: "media",
    artifact: MediaModule,
    compose: ({
      environment,
      productRepository,
      storeRepository,
      authorizeConversationMedia,
    }) =>
      MediaModule.register(
        environment,
        undefined,
        async (mediaId) => {
          if (await storeRepository.isMediaPublished(mediaId)) return true;
          const storeId = await productRepository.findPublishedMediaStoreId(mediaId);
          if (!storeId) return false;
          return (await storeRepository.findById(storeId))?.status === "PUBLISHED";
        },
        authorizeConversationMedia,
      ),
  },
  {
    owner: "store",
    artifact: StoreModule,
    compose: ({ environment, storeFollowingRepository, storeRepository }) =>
      StoreModule.register(environment, {
        repository: storeRepository,
        publicStoreFollowingReader: storeFollowingRepository,
      }),
  },
  {
    owner: "product",
    artifact: ProductModule,
    compose: ({ environment, productRepository }) =>
      ProductModule.register(environment, { repository: productRepository }),
  },
  {
    owner: "inventory",
    artifact: InventoryModule,
    compose: ({ environment, inventoryAuthoring, productRepository }) =>
      InventoryModule.register(environment, {
        repository: inventoryAuthoring,
        products: productRepository,
        createProductTransactionContext: (transaction) =>
          createOpaqueProductTransactionContext(transaction as never),
      }),
  },
  {
    owner: "orders",
    artifact: OrdersModule,
    compose: ({
      checkoutRepository,
      environment,
      inventoryAuthoring,
      productRepository,
      storeRepository,
    }) =>
      OrdersModule.register(environment, {
        checkoutRepository,
        products: productRepository,
        inventory: inventoryAuthoring,
        createProductTransactionContext: createOpaqueProductTransactionContext,
        createStoreTransactionContext: createOpaqueStoreTransactionContext,
        resolveSellerStore: async (identityId) =>
          (await storeRepository.findBySellerId(identityId))?.id,
      }),
  },
  {
    owner: "payments",
    artifact: PaymentsModule,
    compose: ({
      checkoutRepository,
      environment,
      identityOptions,
      inventoryAuthoring,
      platformAgentSessions,
    }) =>
      PaymentsModule.register(environment, {
        inventory: inventoryAuthoring,
        orders: checkoutRepository,
        platformAgentSessions:
          identityOptions.platformAgentSessionAuthorizer ?? platformAgentSessions,
      }),
  },
  {
    owner: "fulfillment",
    artifact: FulfillmentModule,
    compose: () => FulfillmentModule,
  },
  {
    owner: "conversations",
    artifact: ConversationsModule,
    compose: ({
      environment,
      productRepository,
      checkoutRepository,
      setConversationMediaAccess,
    }) =>
      ConversationsModule.register(environment, {
        products: productRepository,
        orders: checkoutRepository,
        onMediaAccessReady: setConversationMediaAccess,
      }),
  },
  {
    owner: "problem-follow-up",
    artifact: ProblemFollowUpModule,
    compose: () => ProblemFollowUpModule,
  },
  { owner: "content", artifact: ContentModule, compose: () => ContentModule },
  {
    owner: "discovery",
    artifact: DiscoveryModule,
    compose: ({ environment, productRepository, storeFollowingRepository }) =>
      DiscoveryModule.register(environment, {
        followingRepository: storeFollowingRepository,
        products: productRepository,
      }),
  },
  {
    owner: "notifications",
    artifact: NotificationsModule,
    compose: () => NotificationsModule,
  },
  {
    owner: "reporting-analytics",
    artifact: ReportingAnalyticsModule,
    compose: () => ReportingAnalyticsModule,
  },
];

export function assertApiModuleArtifact(
  slot: { owner: string; artifact: Type<unknown> },
  composed: NestModule,
): NestModule {
  const actualArtifact = typeof composed === "function" ? composed : composed.module;
  if (actualArtifact !== slot.artifact) {
    throw new Error(
      `API composition slot ${slot.owner} returned a different module artifact`,
    );
  }
  return composed;
}

export function composeCanonicalApiModules(
  environment: RuntimeEnvironment,
  identityOptions: IdentityAccessModuleOptions = {},
): NestModule[] {
  const context = createApiCompositionContext(environment, identityOptions);
  return canonicalApiModuleRegistry.map((slot) =>
    assertApiModuleArtifact(slot, slot.compose(context)),
  );
}
