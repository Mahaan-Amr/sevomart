import type {
  ProductBatchResult,
  ProductAuthoritativeVariantV1,
  ProductView,
  PublicProduct,
  PublicProductSummary,
  ReplaceProductInventoryBatch,
  ReplaceProductOffersBatch,
  ReplaceProductWorkingCopy,
  UnpublishProductInput,
  PublicSimpleProduct,
  PublicSimpleProductSummary,
  ReplaceSimpleProductWorkingCopy,
  SimpleProductView,
  SellerProductSummary,
} from "@sevo/contracts/product/v1";
import type {
  IdentityId,
  ProductId,
  StoreId,
  VariantId,
} from "@sevo/contracts/platform/v1";

export type ProductWriteContext = Readonly<{
  operation:
    | "CREATE_PRODUCT"
    | "REPLACE_WORKING_COPY"
    | "REPLACE_OFFERS_BATCH"
    | "REPLACE_INVENTORY_BATCH"
    | "PUBLISH_PRODUCT"
    | "UNPUBLISH_PRODUCT";
  actorId: IdentityId;
  correlationId: string;
  idempotencyKey: string;
  requestHash: string;
  expectedRevision: number;
}>;

export type ProductAuthoritativeVariant = Readonly<ProductAuthoritativeVariantV1>;

export type OpaqueProductTransactionContext = Readonly<{
  kind: "opaque-product-transaction";
}>;

export interface ProductAuthoritativeRead {
  readAuthoritativeVariant(
    variantId: VariantId,
  ): Promise<ProductAuthoritativeVariant | undefined>;
  readAuthoritativeVariantInTransaction?(
    transaction: OpaqueProductTransactionContext,
    variantId: VariantId,
  ): Promise<ProductAuthoritativeVariant | undefined>;
  readPublishedProduct(
    productId: ProductId,
    storeId: StoreId,
  ): Promise<PublicProduct | undefined>;
  readPublished(
    productId: ProductId,
    storeId: StoreId,
  ): Promise<PublicSimpleProduct | undefined>;
}

export interface ProductRepository extends ProductAuthoritativeRead {
  readActiveProductCount(storeId: StoreId): Promise<number>;
  listOwned(
    storeId: StoreId,
    query: Readonly<{
      cursor?: { createdAt: string; productId: ProductId };
      limit: number;
      state?: "DRAFT" | "PUBLISHED" | "UNPUBLISHED";
    }>,
  ): Promise<Array<{ summary: SellerProductSummary; createdAt: string }>>;
  create(
    productId: ProductId,
    storeId: StoreId,
    context: ProductWriteContext,
  ): Promise<SimpleProductView>;
  replaceWorkingCopy(
    productId: ProductId,
    storeId: StoreId,
    variantId: VariantId,
    input: ReplaceSimpleProductWorkingCopy,
    context: ProductWriteContext,
  ): Promise<SimpleProductView>;
  readOwned(
    productId: ProductId,
    storeId: StoreId,
  ): Promise<SimpleProductView | undefined>;
  publish(
    productId: ProductId,
    storeId: StoreId,
    context: ProductWriteContext,
  ): Promise<PublicSimpleProduct>;
  listPublished(storeId: StoreId): Promise<PublicSimpleProductSummary[]>;
  findPublishedMediaStoreId(mediaId: string): Promise<StoreId | undefined>;
  replaceProductWorkingCopy(
    productId: ProductId,
    storeId: StoreId,
    input: ReplaceProductWorkingCopy,
    context: ProductWriteContext,
  ): Promise<ProductView>;
  readProductOwned(
    productId: ProductId,
    storeId: StoreId,
  ): Promise<ProductView | undefined>;
  previewProduct(productId: ProductId, storeId: StoreId): Promise<PublicProduct>;
  replaceOffersBatch(
    productId: ProductId,
    storeId: StoreId,
    input: ReplaceProductOffersBatch,
    context: ProductWriteContext,
  ): Promise<ProductBatchResult>;
  replaceInventoryBatch(
    productId: ProductId,
    storeId: StoreId,
    input: ReplaceProductInventoryBatch,
    context: ProductWriteContext,
  ): Promise<ProductBatchResult>;
  publishProduct(
    productId: ProductId,
    storeId: StoreId,
    context: ProductWriteContext,
  ): Promise<PublicProduct>;
  unpublishProduct(
    productId: ProductId,
    storeId: StoreId,
    input: UnpublishProductInput,
    context: ProductWriteContext,
  ): Promise<ProductView | SimpleProductView>;
  listPublishedProducts(storeId: StoreId): Promise<PublicProductSummary[]>;
}

export class ProductNotFoundError extends Error {}
export class ProductNotReadyError extends Error {}
export class SellerAccessInactiveError extends Error {}
export class InvalidVariantError extends Error {}
export class DuplicateSkuError extends Error {}
export class ProductInvalidTransitionError extends Error {}

export class ProductRevisionConflictError extends Error {
  readonly code = "REVISION_CONFLICT" as const;
  constructor(
    readonly expectedRevision: number,
    readonly currentRevision: number,
  ) {
    super("Product revision does not match the expected revision");
  }
}

export class ProductIdempotencyConflictError extends Error {
  readonly code = "IDEMPOTENCY_CONFLICT" as const;
}
