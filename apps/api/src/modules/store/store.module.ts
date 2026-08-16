import { DynamicModule, Module } from "@nestjs/common";
import type { RuntimeEnvironment } from "@sevo/config";
import { MEDIA_STORAGE, type MediaStorage } from "../media/public";

import { StoreService } from "./application/store.service";
import { PostgresStoreRepository } from "./infrastructure/postgres-store.repository";
import type { SettlementDestinationVerifier, StoreRepository } from "./public";
import { StoreController } from "./store.controller";
import {
  SETTLEMENT_DESTINATION_VERIFIER,
  STORE_REPOSITORY,
  STORE_SERVICE,
} from "./store.tokens";
import { TestSettlementDestinationVerifier } from "./testing/test-settlement-verifier";

export type StoreModuleOptions = {
  repository?: StoreRepository;
  settlementVerifier?: SettlementDestinationVerifier;
};

@Module({})
export class StoreModule {
  static register(
    environment: RuntimeEnvironment,
    options: StoreModuleOptions = {},
  ): DynamicModule {
    return {
      module: StoreModule,
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
          inject: [STORE_REPOSITORY, SETTLEMENT_DESTINATION_VERIFIER, MEDIA_STORAGE],
          useFactory: (
            repository: StoreRepository,
            verifier: SettlementDestinationVerifier,
            mediaStorage: MediaStorage,
          ) =>
            new StoreService(
              repository,
              (destination) => verifier.verify(destination),
              undefined,
              (id) => mediaStorage.get(id),
              (id, sellerId) => mediaStorage.makePublic(id, sellerId),
            ),
        },
      ],
    };
  }
}
