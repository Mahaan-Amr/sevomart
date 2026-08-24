import { DynamicModule, Module } from "@nestjs/common";
import type { RuntimeEnvironment } from "@sevo/config";

import type { InventoryAuthoring } from "../inventory/public";
import type { ProductAuthoritativeRead } from "../product/public";
import type { StoreRepository } from "../store/public";
import { CartService } from "./application/cart.service";
import { CartController } from "./cart.controller";
import { PostgresCartRepository } from "./infrastructure/postgres-cart.repository";
import { CART_REPOSITORY, CART_SERVICE } from "./orders.tokens";
import type { CartRepository } from "./public";

export type OrdersModuleOptions = {
  repository?: CartRepository;
  products: ProductAuthoritativeRead;
  inventory: InventoryAuthoring;
  stores: Pick<StoreRepository, "findById">;
};

@Module({})
export class OrdersModule {
  static register(
    environment: RuntimeEnvironment,
    options: OrdersModuleOptions,
  ): DynamicModule {
    return {
      module: OrdersModule,
      controllers: [CartController],
      providers: [
        { provide: "ORDERS_RUNTIME_ENVIRONMENT", useValue: environment },
        {
          provide: CART_REPOSITORY,
          useValue:
            options.repository ?? new PostgresCartRepository(environment.DATABASE_URL),
        },
        {
          provide: CART_SERVICE,
          inject: [CART_REPOSITORY],
          useFactory: (repository: CartRepository) =>
            new CartService(
              repository,
              options.products,
              options.inventory,
              options.stores,
              environment.CART_GUEST_SECRET,
            ),
        },
      ],
    };
  }
}

export { PostgresCartRepository } from "./infrastructure/postgres-cart.repository";
