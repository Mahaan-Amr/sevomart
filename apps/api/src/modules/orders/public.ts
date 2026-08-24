import type {
  AttachCartInput,
  Cart,
  CartConflict,
  CartId,
  RemoveCartItemInput,
} from "@sevo/contracts/orders/v1";
import type {
  IdentityId,
  ProductId,
  StoreId,
  VariantId,
} from "@sevo/contracts/platform/v1";

export type StoredCartItem = Readonly<{
  productId: ProductId;
  variantId: VariantId;
  quantity: number;
}>;

export type StoredCart = Readonly<{
  cartId: CartId;
  storeId: StoreId;
  identityId?: IdentityId;
  revision: number;
  items: readonly StoredCartItem[];
}>;

export type CartMutationCommand = Readonly<{
  identityId?: IdentityId;
  guestTokenHash: string;
  newCartId: CartId;
  newAccessTokenId: string;
  storeId: StoreId;
  productId: ProductId;
  variantId: VariantId;
  quantity: number;
  expectedRevision: number;
  idempotencyKey: string;
  requestHash: string;
  expiresAt: Date;
}>;

export interface CartRepository {
  readGuest(tokenHash: string): Promise<StoredCart | undefined>;
  readBuyer(identityId: IdentityId): Promise<StoredCart | undefined>;
  mutate(command: CartMutationCommand): Promise<StoredCart>;
  remove(command: {
    identityId?: IdentityId;
    guestTokenHash: string;
    variantId: VariantId;
    input: RemoveCartItemInput;
    idempotencyKey: string;
    requestHash: string;
    expiresAt: Date;
  }): Promise<StoredCart>;
  replaceStore(
    command: CartMutationCommand & {
      replacementTokenHash: string;
    },
  ): Promise<StoredCart>;
  inspectAttachment(
    identityId: IdentityId,
    guestTokenHash: string,
  ): Promise<
    | { status: "NONE"; cart?: StoredCart }
    | { status: "ATTACHED"; cart: StoredCart }
    | { status: "CONFLICT"; guest: StoredCart; buyer: StoredCart }
  >;
  resolveAttachment(command: {
    identityId: IdentityId;
    guestTokenHash: string;
    input: AttachCartInput;
    idempotencyKey: string;
    requestHash: string;
  }): Promise<StoredCart>;
}

export type CartReadResult = { cart: Cart | null };
export type CartAttachmentResult =
  | { status: "ATTACHED"; cart: Cart }
  | { status: "RESOLUTION_REQUIRED"; conflict: CartConflict };

export class CartRevisionConflictError extends Error {
  readonly code = "CART_REVISION_CONFLICT" as const;
}
export class CartIdempotencyConflictError extends Error {
  readonly code = "IDEMPOTENCY_CONFLICT" as const;
}
export class CartStoreReplacementRequiredError extends Error {
  readonly code = "STORE_REPLACEMENT_CONFIRMATION_REQUIRED" as const;
  constructor(
    readonly currentStoreId: StoreId,
    readonly nextStoreId: StoreId,
    readonly currentStoreName?: string,
    readonly nextStoreName?: string,
    readonly removedItemCount?: number,
  ) {
    super("Cart belongs to another store");
  }
}
export class CartResolutionRequiredError extends Error {
  readonly code = "CART_RESOLUTION_REQUIRED" as const;
}
export class CartVariantUnavailableError extends Error {
  readonly code = "VARIANT_UNAVAILABLE" as const;
}
export class CartQuantityLimitError extends Error {
  readonly code = "INVALID_QUANTITY" as const;
}

export class CartLineLimitError extends Error {
  readonly code = "CART_LIMIT_REACHED" as const;
}
