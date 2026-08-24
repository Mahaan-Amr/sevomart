import { createHash, randomUUID } from "node:crypto";

import {
  productPreviewContract,
  publicProductListContract,
  publicSimpleProductListContract,
  simpleProductPreviewContract,
  type ReplaceProductInventoryBatch,
  type ReplaceProductOffersBatch,
  type ReplaceProductWorkingCopy,
  type UnpublishProductInput,
  type ReplaceSimpleProductWorkingCopy,
  type SimpleProductView,
} from "@sevo/contracts/product/v1";
import {
  identityIdContract,
  productIdContract,
  variantIdContract,
  type ProductId,
} from "@sevo/contracts/platform/v1";
import { storeSlugContract } from "@sevo/contracts/store/v1";

import type { SellerAccessRead } from "../../identity-access/public";
import type { MediaStorage } from "../../media/public";
import type { StoreAuthoritativeRead } from "../../store/public";
import {
  ProductNotFoundError,
  ProductNotReadyError,
  SellerAccessInactiveError,
  type ProductRepository,
  type ProductWriteContext,
} from "../public";

type WriteInput = Readonly<{
  correlationId: string;
  idempotencyKey: string;
  expectedRevision: number;
}>;

export class ProductService {
  constructor(
    private readonly repository: ProductRepository,
    private readonly stores: StoreAuthoritativeRead,
    private readonly media: MediaStorage,
    private readonly sellerAccess: SellerAccessRead,
  ) {}

  async create(identityId: string, write: WriteInput): Promise<SimpleProductView> {
    const actorId = identityIdContract.parse(identityId);
    await this.requireActiveSeller(actorId);
    const store = await this.stores.readOwnedStore(actorId);
    if (!store) throw new ProductNotFoundError();
    const productId = productIdContract.parse(randomUUID());
    return this.repository.create(
      productId,
      store.storeId,
      context("CREATE_PRODUCT", identityId, write, {}),
    );
  }

  async replaceWorkingCopy(
    identityId: string,
    productId: ProductId,
    input: ReplaceSimpleProductWorkingCopy,
    write: WriteInput,
  ) {
    const actorId = identityIdContract.parse(identityId);
    await this.requireActiveSeller(actorId);
    const store = await this.stores.readOwnedStore(actorId);
    if (!store) throw new ProductNotFoundError();
    const mediaId = input.workingCopy.orderedMediaIds[0];
    if (mediaId) {
      const asset = await this.media.inspect(mediaId);
      if (
        !asset ||
        asset.ownerSellerId !== identityId ||
        asset.ownerReferenceId !== productId ||
        asset.purpose !== "PRODUCT_IMAGE"
      ) {
        throw new ProductNotReadyError();
      }
    }
    return this.repository.replaceWorkingCopy(
      productId,
      store.storeId,
      variantIdContract.parse(randomUUID()),
      input,
      context("REPLACE_WORKING_COPY", identityId, write, input),
    );
  }

  async replaceProductWorkingCopy(
    identityId: string,
    productId: ProductId,
    input: ReplaceProductWorkingCopy,
    write: WriteInput,
  ) {
    const actorId = identityIdContract.parse(identityId);
    await this.requireActiveSeller(actorId);
    const store = await this.stores.readOwnedStore(actorId);
    if (!store) throw new ProductNotFoundError();
    for (const mediaId of input.workingCopy.orderedMediaIds) {
      const asset = await this.media.inspect(mediaId);
      if (
        !asset ||
        asset.ownerSellerId !== identityId ||
        asset.ownerReferenceId !== productId ||
        asset.purpose !== "PRODUCT_IMAGE"
      ) {
        throw new ProductNotReadyError();
      }
    }
    return this.repository.replaceProductWorkingCopy(
      productId,
      store.storeId,
      input,
      context("REPLACE_WORKING_COPY", identityId, write, input),
    );
  }

  async readSellerProduct(identityId: string, productId: ProductId) {
    const actorId = identityIdContract.parse(identityId);
    await this.requireActiveSeller(actorId);
    const store = await this.stores.readOwnedStore(actorId);
    if (!store) throw new ProductNotFoundError();
    const product =
      (await this.repository.readProductOwned(productId, store.storeId)) ??
      (await this.repository.readOwned(productId, store.storeId));
    if (!product) throw new ProductNotFoundError();
    return product;
  }

  async preview(identityId: string, productId: ProductId) {
    await this.requireActiveSeller(identityIdContract.parse(identityId));
    const actorId = identityIdContract.parse(identityId);
    const store = await this.stores.readOwnedStore(actorId);
    if (!store) throw new ProductNotFoundError();
    const productView = await this.repository.readProductOwned(
      productId,
      store.storeId,
    );
    if (productView) {
      const working = productView.workingCopy;
      const inventoryIds = new Set(productView.inventory.map((row) => row.variantId));
      const issues = !working
        ? [{ path: "workingCopy", code: "REQUIRED" }]
        : [
            ...(working.name ? [] : [{ path: "details.name", code: "REQUIRED" }]),
            ...(working.orderedMediaIds.length > 0
              ? []
              : [{ path: "images", code: "REQUIRED" }]),
            ...(working.variants.length > 0
              ? []
              : [{ path: "sale.variants", code: "REQUIRED" }]),
            ...working.variants.flatMap((variant, index) => [
              ...(variant.price
                ? []
                : [{ path: `sale.variants.${index}.price`, code: "REQUIRED" }]),
              ...(inventoryIds.has(variant.variantId)
                ? []
                : [{ path: `sale.variants.${index}.inventory`, code: "REQUIRED" }]),
            ]),
          ];
      return productPreviewContract.parse({
        product: productView,
        ready: issues.length === 0,
        issues,
        projection:
          issues.length === 0
            ? await this.repository.previewProduct(productId, store.storeId)
            : null,
      });
    }
    const product = await this.readOwned(identityId, productId);
    const issues = !product.workingCopy
      ? [{ path: "workingCopy", code: "REQUIRED" }]
      : [
          ...(product.workingCopy.name ? [] : [{ path: "name", code: "REQUIRED" }]),
          ...(product.workingCopy.orderedMediaIds.length === 1
            ? []
            : [{ path: "image", code: "REQUIRED" }]),
          ...(product.workingCopy.variant.price
            ? []
            : [{ path: "price", code: "REQUIRED" }]),
          ...(product.inventory ? [] : [{ path: "inventory", code: "REQUIRED" }]),
        ];
    return simpleProductPreviewContract.parse({
      product,
      ready: issues.length === 0,
      issues,
    });
  }

  async publish(identityId: string, productId: ProductId, write: WriteInput) {
    const actorId = identityIdContract.parse(identityId);
    await this.requireActiveSeller(actorId);
    const ownedStore = await this.stores.readOwnedStore(actorId);
    if (!ownedStore) throw new ProductNotFoundError();
    const productView = await this.repository.readProductOwned(
      productId,
      ownedStore.storeId,
    );
    if (productView) {
      const preview = await this.preview(identityId, productId);
      if (!("projection" in preview) || !preview.ready || !preview.projection) {
        throw new ProductNotReadyError();
      }
      const store = await this.stores.requireOwnedSellable(actorId, ownedStore.storeId);
      for (const mediaId of productView.workingCopy!.orderedMediaIds) {
        await this.media.makePublic(mediaId, identityId);
      }
      return this.repository.publishProduct(
        productId,
        store.storeId,
        context("PUBLISH_PRODUCT", identityId, write, { productId }),
      );
    }
    const owned = await this.readOwned(identityId, productId);
    if (
      !owned.workingCopy?.name ||
      owned.workingCopy.orderedMediaIds.length !== 1 ||
      !owned.workingCopy.variant.price ||
      !owned.inventory
    ) {
      throw new ProductNotReadyError();
    }
    const store = await this.stores.requireOwnedSellable(actorId, ownedStore.storeId);
    const mediaId = owned.workingCopy.orderedMediaIds[0]!;
    const asset = await this.media.inspect(mediaId);
    if (
      !asset ||
      asset.ownerSellerId !== identityId ||
      asset.ownerReferenceId !== productId ||
      asset.purpose !== "PRODUCT_IMAGE"
    ) {
      throw new ProductNotReadyError();
    }
    await this.media.makePublic(mediaId, identityId);
    return this.repository.publish(
      productId,
      store.storeId,
      context("PUBLISH_PRODUCT", identityId, write, { productId }),
    );
  }

  async unpublish(
    identityId: string,
    productId: ProductId,
    input: UnpublishProductInput,
    write: WriteInput,
  ) {
    const actorId = identityIdContract.parse(identityId);
    await this.requireActiveSeller(actorId);
    const store = await this.stores.readOwnedStore(actorId);
    if (!store) throw new ProductNotFoundError();
    return this.repository.unpublishProduct(
      productId,
      store.storeId,
      input,
      context("UNPUBLISH_PRODUCT", identityId, write, input),
    );
  }

  async readPublic(storeSlug: string, productId: ProductId) {
    const parsedSlug = storeSlugContract.safeParse(storeSlug);
    if (!parsedSlug.success) throw new ProductNotFoundError();
    const store = await this.stores.readPublishedStoreBySlug(parsedSlug.data);
    if (!store) throw new ProductNotFoundError();
    const product =
      (await this.repository.readPublishedProduct(productId, store.storeId)) ??
      (await this.repository.readPublished(productId, store.storeId));
    if (!product) throw new ProductNotFoundError();
    return product;
  }

  async listPublic(storeSlug: string) {
    const parsedSlug = storeSlugContract.safeParse(storeSlug);
    if (!parsedSlug.success) throw new ProductNotFoundError();
    const store = await this.stores.readPublishedStoreBySlug(parsedSlug.data);
    if (!store) throw new ProductNotFoundError();
    const multivariant = await this.repository.listPublishedProducts(store.storeId);
    const simple = await this.repository.listPublished(store.storeId);
    return multivariant.length > 0
      ? publicProductListContract.parse({ products: [...multivariant, ...simple] })
      : publicSimpleProductListContract.parse({ products: simple });
  }

  async replaceOffersBatch(
    identityId: string,
    productId: ProductId,
    input: ReplaceProductOffersBatch,
    write: WriteInput,
  ) {
    const actorId = identityIdContract.parse(identityId);
    await this.requireActiveSeller(actorId);
    const store = await this.stores.readOwnedStore(actorId);
    if (!store) throw new ProductNotFoundError();
    return this.repository.replaceOffersBatch(
      productId,
      store.storeId,
      input,
      context("REPLACE_OFFERS_BATCH", identityId, write, input),
    );
  }

  async replaceInventoryBatch(
    identityId: string,
    productId: ProductId,
    input: ReplaceProductInventoryBatch,
    write: WriteInput,
  ) {
    const actorId = identityIdContract.parse(identityId);
    await this.requireActiveSeller(actorId);
    const store = await this.stores.readOwnedStore(actorId);
    if (!store) throw new ProductNotFoundError();
    return this.repository.replaceInventoryBatch(
      productId,
      store.storeId,
      input,
      context("REPLACE_INVENTORY_BATCH", identityId, write, input),
    );
  }

  private async readOwned(identityId: string, productId: ProductId) {
    const store = await this.stores.readOwnedStore(
      identityIdContract.parse(identityId),
    );
    if (!store) throw new ProductNotFoundError();
    const product = await this.repository.readOwned(productId, store.storeId);
    if (!product) throw new ProductNotFoundError();
    return product;
  }

  private async requireActiveSeller(
    identityId: ReturnType<typeof identityIdContract.parse>,
  ) {
    if (!(await this.sellerAccess.isActiveSeller(identityId))) {
      throw new SellerAccessInactiveError();
    }
  }
}

function context(
  operation: ProductWriteContext["operation"],
  actorId: string,
  write: WriteInput,
  payload: unknown,
): ProductWriteContext {
  return {
    operation,
    actorId: identityIdContract.parse(actorId),
    correlationId: write.correlationId,
    idempotencyKey: write.idempotencyKey,
    expectedRevision: write.expectedRevision,
    requestHash: createHash("sha256")
      .update(JSON.stringify({ expectedRevision: write.expectedRevision, payload }))
      .digest("hex"),
  };
}
