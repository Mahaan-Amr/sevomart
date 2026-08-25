import { DynamicModule, Module } from "@nestjs/common";
import type { RuntimeEnvironment } from "@sevo/config";
import type { Sql } from "postgres";

import type { InventoryAuthoring } from "../inventory/public";
import type {
  OpaqueProductTransactionContext,
  ProductAuthoritativeRead,
} from "../product/public";
import {
  STORE_AUTHORITATIVE_READ,
  type OpaqueStoreTransactionContext,
  type StoreAuthoritativeRead,
} from "../store/public";
import { CartService } from "./application/cart.service";
import { CheckoutExpiryRunner } from "./application/checkout-expiry.runner";
import { CheckoutService } from "./application/checkout.service";
import { SavedAddressService } from "./application/saved-address.service";
import { CartController } from "./cart.controller";
import { CheckoutController } from "./checkout.controller";
import { PostgresCheckoutRepository } from "./infrastructure/postgres-checkout.repository";
import { PostgresCartRepository } from "./infrastructure/postgres-cart.repository";
import { PostgresSavedAddressRepository } from "./infrastructure/postgres-saved-address.repository";
import {
  CART_REPOSITORY,
  CART_SERVICE,
  CHECKOUT_REPOSITORY,
  CHECKOUT_SERVICE,
  SAVED_ADDRESS_REPOSITORY,
  SAVED_ADDRESS_SERVICE,
} from "./orders.tokens";
import type {
  CartRepository,
  CheckoutRepository,
  SavedAddressRepository,
} from "./public";
import { SavedAddressController } from "./saved-address.controller";

export type OrdersModuleOptions = {
  repository?: CartRepository;
  savedAddressRepository?: SavedAddressRepository;
  checkoutRepository?: CheckoutRepository;
  products: ProductAuthoritativeRead;
  inventory: InventoryAuthoring;
  createProductTransactionContext: (
    transaction: Sql,
  ) => OpaqueProductTransactionContext;
  createStoreTransactionContext: (transaction: Sql) => OpaqueStoreTransactionContext;
};

@Module({})
export class OrdersModule {
  static register(
    environment: RuntimeEnvironment,
    options: OrdersModuleOptions,
  ): DynamicModule {
    return {
      module: OrdersModule,
      controllers: [CartController, SavedAddressController, CheckoutController],
      providers: [
        { provide: "ORDERS_RUNTIME_ENVIRONMENT", useValue: environment },
        {
          provide: CART_REPOSITORY,
          useValue:
            options.repository ?? new PostgresCartRepository(environment.DATABASE_URL),
        },
        {
          provide: CHECKOUT_REPOSITORY,
          inject: [STORE_AUTHORITATIVE_READ],
          useFactory: (stores: StoreAuthoritativeRead) =>
            options.checkoutRepository ??
            new PostgresCheckoutRepository(
              environment.DATABASE_URL,
              options.inventory,
              options.products,
              stores,
              options.createProductTransactionContext,
              options.createStoreTransactionContext,
            ),
        },
        {
          provide: CHECKOUT_SERVICE,
          inject: [
            CHECKOUT_REPOSITORY,
            CART_REPOSITORY,
            SAVED_ADDRESS_REPOSITORY,
            STORE_AUTHORITATIVE_READ,
          ],
          useFactory: (
            repository: CheckoutRepository,
            carts: CartRepository,
            addresses: SavedAddressRepository,
            stores: StoreAuthoritativeRead,
          ) =>
            new CheckoutService(
              repository,
              carts,
              addresses,
              options.products,
              options.inventory,
              stores,
            ),
        },
        {
          provide: CheckoutExpiryRunner,
          inject: [CHECKOUT_REPOSITORY, "ORDERS_RUNTIME_ENVIRONMENT"],
          useFactory: (repository: CheckoutRepository, runtime: RuntimeEnvironment) =>
            new CheckoutExpiryRunner(repository, runtime),
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
export { PostgresCheckoutRepository } from "./infrastructure/postgres-checkout.repository";
