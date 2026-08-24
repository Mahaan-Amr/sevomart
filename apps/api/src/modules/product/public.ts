import type {
  PublicSimpleProduct,
  ReplaceSimpleProductWorkingCopy,
  SimpleProductView,
} from "@sevo/contracts/product/v1";
import type {
  IdentityId,
  ProductId,
  StoreId,
  VariantId,
} from "@sevo/contracts/platform/v1";

export type ProductWriteContext = Readonly<{
  operation: "CREATE_PRODUCT" | "REPLACE_WORKING_COPY" | "PUBLISH_PRODUCT";
  actorId: IdentityId;
  correlationId: string;
  idempotencyKey: string;
  requestHash: string;
  expectedRevision: number;
}>;

export interface ProductRepository {
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
  readPublished(
    productId: ProductId,
    storeId: StoreId,
  ): Promise<PublicSimpleProduct | undefined>;
  listPublished(storeId: StoreId): Promise<PublicSimpleProduct[]>;
  findPublishedMediaStoreId(mediaId: string): Promise<StoreId | undefined>;
}

export class ProductNotFoundError extends Error {}
export class ProductNotReadyError extends Error {}
export class SellerAccessInactiveError extends Error {}

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
