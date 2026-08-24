import { DynamicModule, Module } from "@nestjs/common";
import type { RuntimeEnvironment } from "@sevo/config";

import { MEDIA_STORAGE, type MediaStorage } from "../media/public";
import { STORE_AUTHORITATIVE_READ, type StoreAuthoritativeRead } from "../store/public";
import { ProductService } from "./application/product.service";
import type { ProductRepository } from "./public";
import { ProductController } from "./product.controller";
import { PRODUCT_REPOSITORY, PRODUCT_SERVICE } from "./product.tokens";

export type ProductModuleOptions = { repository?: ProductRepository };

@Module({})
export class ProductModule {
  static register(
    _environment: RuntimeEnvironment,
    options: ProductModuleOptions = {},
  ): DynamicModule {
    if (!options.repository) {
      throw new Error("Product repository must be composed with inventory ownership");
    }
    return {
      module: ProductModule,
      controllers: [ProductController],
      providers: [
        { provide: PRODUCT_REPOSITORY, useValue: options.repository },
        {
          provide: PRODUCT_SERVICE,
          inject: [PRODUCT_REPOSITORY, STORE_AUTHORITATIVE_READ, MEDIA_STORAGE],
          useFactory: (
            repository: ProductRepository,
            stores: StoreAuthoritativeRead,
            media: MediaStorage,
          ) => new ProductService(repository, stores, media),
        },
      ],
    };
  }
}

export { PostgresProductRepository } from "./infrastructure/postgres-product.repository";
