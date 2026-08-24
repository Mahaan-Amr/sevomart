import { DynamicModule, Module } from "@nestjs/common";
import type { RuntimeEnvironment } from "@sevo/config";

import { STORE_AUTHORITATIVE_READ, type StoreAuthoritativeRead } from "../store/public";
import type { ProductAuthoritativeRead } from "../product/public";
import { StoreFollowingService } from "./application/store-following.service";
import { DiscoveryFeedService } from "./application/discovery-feed.service";
import { DiscoveryController } from "./discovery.controller";
import { DiscoveryFeedController } from "./discovery-feed.controller";
import {
  DISCOVERY_FEED_PRODUCT_READ,
  DISCOVERY_FEED_REPOSITORY,
  DISCOVERY_FEED_SERVICE,
  STORE_FOLLOWING_SERVICE,
} from "./discovery.tokens";
import { PostgresDiscoveryFeedRepository } from "./infrastructure/postgres-discovery-feed.repository";
import { PostgresStoreFollowingRepository } from "./infrastructure/postgres-store-following.repository";
import {
  STORE_FOLLOW_REPOSITORY,
  type DiscoveryFeedRepository,
  type StoreFollowRepository,
} from "./public";

export type DiscoveryModuleOptions = {
  followingRepository?: StoreFollowRepository;
  feedRepository?: DiscoveryFeedRepository;
  products: ProductAuthoritativeRead;
};

@Module({})
export class DiscoveryModule {
  static register(
    environment: RuntimeEnvironment,
    options: DiscoveryModuleOptions,
  ): DynamicModule {
    const followingRepository =
      options.followingRepository ??
      new PostgresStoreFollowingRepository(environment.DATABASE_URL);
    const feedRepository =
      options.feedRepository ??
      new PostgresDiscoveryFeedRepository(environment.DATABASE_URL);
    return {
      module: DiscoveryModule,
      controllers: [DiscoveryController, DiscoveryFeedController],
      providers: [
        { provide: STORE_FOLLOW_REPOSITORY, useValue: followingRepository },
        { provide: DISCOVERY_FEED_REPOSITORY, useValue: feedRepository },
        { provide: DISCOVERY_FEED_PRODUCT_READ, useValue: options.products },
        {
          provide: STORE_FOLLOWING_SERVICE,
          inject: [STORE_FOLLOW_REPOSITORY, STORE_AUTHORITATIVE_READ],
          useFactory: (
            follows: StoreFollowRepository,
            stores: StoreAuthoritativeRead,
          ) => new StoreFollowingService(follows, stores),
        },
        {
          provide: DISCOVERY_FEED_SERVICE,
          inject: [
            DISCOVERY_FEED_REPOSITORY,
            STORE_AUTHORITATIVE_READ,
            DISCOVERY_FEED_PRODUCT_READ,
          ],
          useFactory: (
            feeds: DiscoveryFeedRepository,
            stores: StoreAuthoritativeRead,
            products: ProductAuthoritativeRead,
          ) =>
            new DiscoveryFeedService(
              feeds,
              stores,
              products,
              {
                activeKeyId: environment.DISCOVERY_CURSOR_ACTIVE_KEY_ID,
                keys: environment.DISCOVERY_CURSOR_KEYRING,
              },
              environment.DISCOVERY_RANKING_SECRET,
            ),
        },
      ],
    };
  }
}

export { PostgresStoreFollowingRepository } from "./infrastructure/postgres-store-following.repository";
export { PostgresDiscoveryFeedRepository } from "./infrastructure/postgres-discovery-feed.repository";
