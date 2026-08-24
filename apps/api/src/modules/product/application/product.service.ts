import { createHash, randomUUID } from "node:crypto";

import {
  publicSimpleProductListContract,
  simpleProductPreviewContract,
  type PublicSimpleProduct,
  type ReplaceSimpleProductWorkingCopy,
  type SimpleProductPreview,
  type SimpleProductView,
} from "@sevo/contracts/product/v1";
import { identityIdContract } from "@sevo/contracts/platform/v1";
import { storeSlugContract } from "@sevo/contracts/store/v1";

import type { MediaStorage } from "../../media/public";
import type { StoreAuthoritativeRead } from "../../store/public";
import {
  ProductNotFoundError,
  ProductNotReadyError,
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
  ) {}

  async create(identityId: string, write: WriteInput): Promise<SimpleProductView> {
    const actorId = identityIdContract.parse(identityId);
    const store = await this.stores.readOwnedStore(actorId);
    if (!store) throw new ProductNotFoundError();
    const productId = randomUUID();
    return this.repository.create(
      productId,
      store.storeId,
      context("CREATE_PRODUCT", identityId, write, {}),
    );
  }

  async replaceWorkingCopy(
    identityId: string,
    productId: string,
    input: ReplaceSimpleProductWorkingCopy,
    write: WriteInput,
  ) {
    const actorId = identityIdContract.parse(identityId);
    const store = await this.stores.readOwnedStore(actorId);
    if (!store) throw new ProductNotFoundError();
    const mediaId = input.workingCopy.orderedMediaIds[0]!;
    const asset = await this.media.inspect(mediaId);
    if (
      !asset ||
      asset.ownerSellerId !== identityId ||
      asset.purpose !== "PRODUCT_IMAGE"
    ) {
      throw new ProductNotReadyError();
    }
    return this.repository.replaceWorkingCopy(
      productId,
      store.storeId,
      randomUUID(),
      input,
      context("REPLACE_WORKING_COPY", identityId, write, input),
    );
  }

  async preview(identityId: string, productId: string): Promise<SimpleProductPreview> {
    const product = await this.readOwned(identityId, productId);
    const issues = product.workingCopy
      ? []
      : [{ path: "workingCopy", code: "REQUIRED" }];
    return simpleProductPreviewContract.parse({
      product,
      ready: issues.length === 0,
      issues,
    });
  }

  async publish(
    identityId: string,
    productId: string,
    write: WriteInput,
  ): Promise<PublicSimpleProduct> {
    const owned = await this.readOwned(identityId, productId);
    if (!owned.workingCopy) throw new ProductNotReadyError();
    const actorId = identityIdContract.parse(identityId);
    const ownedStore = await this.stores.readOwnedStore(actorId);
    if (!ownedStore) throw new ProductNotFoundError();
    const store = await this.stores.requireOwnedSellable(actorId, ownedStore.storeId);
    const mediaId = owned.workingCopy.orderedMediaIds[0]!;
    const asset = await this.media.inspect(mediaId);
    if (
      !asset ||
      asset.ownerSellerId !== identityId ||
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

  async readPublic(storeSlug: string, productId: string) {
    const parsedSlug = storeSlugContract.safeParse(storeSlug);
    if (!parsedSlug.success) throw new ProductNotFoundError();
    const store = await this.stores.readPublishedStoreBySlug(parsedSlug.data);
    if (!store) throw new ProductNotFoundError();
    const product = await this.repository.readPublished(productId, store.storeId);
    if (!product) throw new ProductNotFoundError();
    return product;
  }

  async listPublic(storeSlug: string) {
    const parsedSlug = storeSlugContract.safeParse(storeSlug);
    if (!parsedSlug.success) throw new ProductNotFoundError();
    const store = await this.stores.readPublishedStoreBySlug(parsedSlug.data);
    if (!store) throw new ProductNotFoundError();
    return publicSimpleProductListContract.parse({
      products: await this.repository.listPublished(store.storeId),
    });
  }

  private async readOwned(identityId: string, productId: string) {
    const store = await this.stores.readOwnedStore(
      identityIdContract.parse(identityId),
    );
    if (!store) throw new ProductNotFoundError();
    const product = await this.repository.readOwned(productId, store.storeId);
    if (!product) throw new ProductNotFoundError();
    return product;
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
    actorId,
    correlationId: write.correlationId,
    idempotencyKey: write.idempotencyKey,
    expectedRevision: write.expectedRevision,
    requestHash: createHash("sha256")
      .update(JSON.stringify({ expectedRevision: write.expectedRevision, payload }))
      .digest("hex"),
  };
}
