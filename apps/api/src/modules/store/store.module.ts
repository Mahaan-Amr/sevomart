import { DynamicModule, Module } from "@nestjs/common";
import type { RuntimeEnvironment } from "@sevo/config";
import { identityIdContract } from "@sevo/contracts/platform/v1";
import { MEDIA_STORAGE, type MediaStorage } from "../media/public";
import { SELLER_ACCESS_READ, type SellerAccessRead } from "../identity-access/public";

import { StoreService } from "./application/store.service";
import { PostgresStoreRepository } from "./infrastructure/postgres-store.repository";
import {
  STORE_AUTHORITATIVE_READ,
  type PublicActiveProductCountReader,
  type PublicStoreFollowingReader,
  type SettlementDestinationVerifier,
  type StoreRepository,
} from "./public";
import { StoreController } from "./store.controller";
import {
  SETTLEMENT_DESTINATION_VERIFIER,
  STORE_REPOSITORY,
  STORE_SERVICE,
  PUBLIC_ACTIVE_PRODUCT_COUNT_READER,
  PUBLIC_STORE_FOLLOWING_READER,
} from "./store.tokens";
import { TestSettlementDestinationVerifier } from "./testing/test-settlement-verifier";

export type StoreModuleOptions = {
  repository?: StoreRepository;
  settlementVerifier?: SettlementDestinationVerifier;
  publicStoreFollowingReader?: PublicStoreFollowingReader;
  publicActiveProductCountReader?: PublicActiveProductCountReader;
};

@Module({})
export class StoreModule {
  static register(
    environment: RuntimeEnvironment,
    options: StoreModuleOptions = {},
  ): DynamicModule {
    return {
      module: StoreModule,
      global: true,
      controllers: [StoreController],
      providers: [
        {
          provide: STORE_REPOSITORY,
          useValue:
            options.repository ?? new PostgresStoreRepository(environment.DATABASE_URL),
        },
        {
          provide: SETTLEMENT_DESTINATION_VERIFIER,
          useValue:
            options.settlementVerifier ?? new TestSettlementDestinationVerifier(),
        },
        {
          provide: STORE_SERVICE,
          inject: [
            STORE_REPOSITORY,
            SETTLEMENT_DESTINATION_VERIFIER,
            MEDIA_STORAGE,
            SELLER_ACCESS_READ,
          ],
          useFactory: (
            repository: StoreRepository,
            verifier: SettlementDestinationVerifier,
            mediaStorage: MediaStorage,
            sellerAccess: SellerAccessRead,
          ) =>
            new StoreService(
              repository,
              (destination) => verifier.verify(destination),
              undefined,
              (id) => mediaStorage.get(id),
              (id, sellerId) =>
                mediaStorage.makePublic(id, identityIdContract.parse(sellerId)),
              (id, sellerId) =>
                mediaStorage.makePrivate(id, identityIdContract.parse(sellerId)),
              sellerAccess,
            ),
        },
        { provide: STORE_AUTHORITATIVE_READ, useExisting: STORE_SERVICE },
        {
          provide: PUBLIC_ACTIVE_PRODUCT_COUNT_READER,
          useValue:
            options.publicActiveProductCountReader ??
            ({
              async readActiveProductCount() {
                return 0;
              },
            } satisfies PublicActiveProductCountReader),
        },
        {
          provide: PUBLIC_STORE_FOLLOWING_READER,
          useValue:
            options.publicStoreFollowingReader ??
            ({
              async readPublicStoreFollowing(storeId, _viewerIdentityId, updatedAt) {
                return {
                  followerCount: {
                    version: 1,
                    storeId,
                    count: 0,
                    updatedAt: updatedAt ?? new Date(0).toISOString(),
                  },
                };
              },
            } satisfies PublicStoreFollowingReader),
        },
      ],
      exports: [STORE_AUTHORITATIVE_READ],
    };
  }
}
