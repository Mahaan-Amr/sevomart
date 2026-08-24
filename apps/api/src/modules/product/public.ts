import type {
  PublicSimpleProduct,
  ReplaceSimpleProductWorkingCopy,
  SimpleProductView,
} from "@sevo/contracts/product/v1";

export type ProductWriteContext = Readonly<{
  operation: "CREATE_PRODUCT" | "REPLACE_WORKING_COPY" | "PUBLISH_PRODUCT";
  actorId: string;
  correlationId: string;
  idempotencyKey: string;
  requestHash: string;
  expectedRevision: number;
}>;

export interface ProductRepository {
  create(
    productId: string,
    storeId: string,
    context: ProductWriteContext,
  ): Promise<SimpleProductView>;
  replaceWorkingCopy(
    productId: string,
    storeId: string,
    variantId: string,
    input: ReplaceSimpleProductWorkingCopy,
    context: ProductWriteContext,
  ): Promise<SimpleProductView>;
  readOwned(productId: string, storeId: string): Promise<SimpleProductView | undefined>;
  publish(
    productId: string,
    storeId: string,
    context: ProductWriteContext,
  ): Promise<PublicSimpleProduct>;
  readPublished(
    productId: string,
    storeId: string,
  ): Promise<PublicSimpleProduct | undefined>;
  listPublished(storeId: string): Promise<PublicSimpleProduct[]>;
  findPublishedMediaStoreId(mediaId: string): Promise<string | undefined>;
}

export class ProductNotFoundError extends Error {}
export class ProductNotReadyError extends Error {}

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
