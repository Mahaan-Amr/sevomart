import { DynamicModule, Module } from "@nestjs/common";
import type { RuntimeEnvironment } from "@sevo/config";

import { SELLER_ACCESS_READ, type SellerAccessRead } from "../identity-access/public";
import type { ProductAuthoritativeRead } from "../product/public";
import { STORE_AUTHORITATIVE_READ, type StoreAuthoritativeRead } from "../store/public";
import { SellerInventoryService } from "./application/seller-inventory.service";
import { InventoryController } from "./inventory.controller";
import {
  INVENTORY_SELLER_REPOSITORY,
  INVENTORY_SELLER_SERVICE,
} from "./inventory.tokens";
import type { SellerInventoryRepository } from "./public";

export type InventoryModuleOptions = {
  repository?: SellerInventoryRepository;
  products?: ProductAuthoritativeRead;
};

@Module({})
export class InventoryModule {
  static register(
    _environment: RuntimeEnvironment,
    options: InventoryModuleOptions = {},
  ): DynamicModule {
    if (!options.repository || !options.products) {
      throw new Error("Inventory authoring requires repository and product reads");
    }
    return {
      module: InventoryModule,
      controllers: [InventoryController],
      providers: [
        { provide: INVENTORY_SELLER_REPOSITORY, useValue: options.repository },
        {
          provide: INVENTORY_SELLER_SERVICE,
          inject: [
            INVENTORY_SELLER_REPOSITORY,
            STORE_AUTHORITATIVE_READ,
            SELLER_ACCESS_READ,
          ],
          useFactory: (
            repository: SellerInventoryRepository,
            stores: StoreAuthoritativeRead,
            sellerAccess: SellerAccessRead,
          ) =>
            new SellerInventoryService(
              repository,
              options.products!,
              stores,
              sellerAccess,
            ),
        },
      ],
    };
  }
}

export { PostgresInventoryAuthoring } from "./infrastructure/postgres-inventory-authoring";
