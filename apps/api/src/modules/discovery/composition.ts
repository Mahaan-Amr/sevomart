import { DynamicModule, Module } from "@nestjs/common";
import type { RuntimeEnvironment } from "@sevo/config";

import { STORE_AUTHORITATIVE_READ, type StoreAuthoritativeRead } from "../store/public";
import { StoreFollowingService } from "./application/store-following.service";
import { DiscoveryController } from "./discovery.controller";
import { STORE_FOLLOWING_SERVICE } from "./discovery.tokens";
import { PostgresStoreFollowingRepository } from "./infrastructure/postgres-store-following.repository";
import { STORE_FOLLOW_REPOSITORY, type StoreFollowRepository } from "./public";

@Module({})
export class DiscoveryModule {
  static register(
    environment: RuntimeEnvironment,
    repository: StoreFollowRepository = new PostgresStoreFollowingRepository(
      environment.DATABASE_URL,
    ),
  ): DynamicModule {
    return {
      module: DiscoveryModule,
      controllers: [DiscoveryController],
      providers: [
        { provide: STORE_FOLLOW_REPOSITORY, useValue: repository },
        {
          provide: STORE_FOLLOWING_SERVICE,
          inject: [STORE_FOLLOW_REPOSITORY, STORE_AUTHORITATIVE_READ],
          useFactory: (
            follows: StoreFollowRepository,
            stores: StoreAuthoritativeRead,
          ) => new StoreFollowingService(follows, stores),
        },
      ],
    };
  }
}

export { PostgresStoreFollowingRepository } from "./infrastructure/postgres-store-following.repository";
