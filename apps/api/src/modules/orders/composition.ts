import { DynamicModule, Module } from "@nestjs/common";
import type { RuntimeEnvironment } from "@sevo/config";

import type { InventoryAuthoring } from "../inventory/public";
import type { ProductAuthoritativeRead } from "../product/public";
import { STORE_AUTHORITATIVE_READ, type StoreAuthoritativeRead } from "../store/public";
import { CartService } from "./application/cart.service";
import { SavedAddressService } from "./application/saved-address.service";
import { CartController } from "./cart.controller";
import { PostgresCartRepository } from "./infrastructure/postgres-cart.repository";
import { PostgresSavedAddressRepository } from "./infrastructure/postgres-saved-address.repository";
import {
  CART_REPOSITORY,
  CART_SERVICE,
  SAVED_ADDRESS_REPOSITORY,
  SAVED_ADDRESS_SERVICE,
} from "./orders.tokens";
import type { CartRepository, SavedAddressRepository } from "./public";
import { SavedAddressController } from "./saved-address.controller";

export type OrdersModuleOptions = {
  repository?: CartRepository;
  savedAddressRepository?: SavedAddressRepository;
  products: ProductAuthoritativeRead;
  inventory: InventoryAuthoring;
};

@Module({})
export class OrdersModule {
  static register(
    environment: RuntimeEnvironment,
    options: OrdersModuleOptions,
  ): DynamicModule {
    return {
      module: OrdersModule,
      controllers: [CartController, SavedAddressController],
      providers: [
        { provide: "ORDERS_RUNTIME_ENVIRONMENT", useValue: environment },
        {
          provide: CART_REPOSITORY,
          useValue:
            options.repository ?? new PostgresCartRepository(environment.DATABASE_URL),
        },
        {
          provide: CART_SERVICE,
          inject: [CART_REPOSITORY, STORE_AUTHORITATIVE_READ],
          useFactory: (repository: CartRepository, stores: StoreAuthoritativeRead) =>
            new CartService(
              repository,
              options.products,
              options.inventory,
              stores,
              environment.CART_TOKEN_DERIVATION_SECRET,
            ),
        },
        {
          provide: SAVED_ADDRESS_REPOSITORY,
          useValue:
            options.savedAddressRepository ??
            new PostgresSavedAddressRepository(environment.DATABASE_URL),
        },
        {
          provide: SAVED_ADDRESS_SERVICE,
          inject: [SAVED_ADDRESS_REPOSITORY],
          useFactory: (repository: SavedAddressRepository) =>
            new SavedAddressService(repository),
        },
      ],
    };
  }
}

export { PostgresCartRepository } from "./infrastructure/postgres-cart.repository";
export { PostgresSavedAddressRepository } from "./infrastructure/postgres-saved-address.repository";
