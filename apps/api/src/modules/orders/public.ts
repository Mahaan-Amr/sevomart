import type {
  AttachCartInput,
  Cart,
  CartConflict,
  CartId,
  CreateSavedAddressInput,
  SavedAddress,
  SavedAddressId,
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
  reviewedPublicationVersion: number;
  reviewedUnitPriceAmount: number;
}>;

export type StoredCart = Readonly<{
  cartId: CartId;
  storeId: StoreId;
  identityId?: IdentityId;
  revision: number;
  reviewedPolicyRevision: number;
  reviewedShippingHash: string;
  items: readonly StoredCartItem[];
}>;

export type CartReviewSnapshot = Readonly<{
  policyRevision: number;
  shippingHash: string;
  items: ReadonlyArray<{
    variantId: VariantId;
    publicationVersion: number;
    unitPriceAmount: number;
  }>;
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
  correlationId: string;
  reviewSnapshot: CartReviewSnapshot;
  expiresAt: Date;
}>;

export interface CartRepository {
  readGuest(tokenHash: string): Promise<StoredCart | undefined>;
  readBuyer(identityId: IdentityId): Promise<StoredCart | undefined>;
  mutate(command: CartMutationCommand): Promise<StoredCart>;
  removeItem(command: {
    identityId?: IdentityId;
    guestTokenHash: string;
    variantId: VariantId;
    expectedRevision: number;
    idempotencyKey: string;
    requestHash: string;
    correlationId: string;
  }): Promise<StoredCart>;
  confirmReview(command: {
    identityId?: IdentityId;
    guestTokenHash: string;
    expectedRevision: number;
    idempotencyKey: string;
    requestHash: string;
    correlationId: string;
    reviewSnapshot: CartReviewSnapshot;
  }): Promise<StoredCart>;
  replaceStore(
    command: CartMutationCommand & {
      replacementTokenHash: string;
    },
  ): Promise<StoredCart>;
  inspectAttachment(command: {
    identityId: IdentityId;
    guestTokenHash: string;
    idempotencyKey: string;
    requestHash: string;
    correlationId: string;
  }): Promise<
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
    correlationId: string;
  }): Promise<StoredCart>;
}

export type StoredSavedAddress = SavedAddress & { identityId: IdentityId };

export interface SavedAddressRepository {
  list(identityId: IdentityId): Promise<SavedAddress[]>;
  create(command: {
    addressId: SavedAddressId;
    identityId: IdentityId;
    input: CreateSavedAddressInput;
    idempotencyKey: string;
    requestHash: string;
    correlationId: string;
  }): Promise<SavedAddress>;
  update(command: {
    addressId: SavedAddressId;
    identityId: IdentityId;
    input: CreateSavedAddressInput;
    expectedRevision: number;
    idempotencyKey: string;
    requestHash: string;
    correlationId: string;
  }): Promise<SavedAddress>;
  delete(command: {
    addressId: SavedAddressId;
    identityId: IdentityId;
    expectedRevision: number;
    idempotencyKey: string;
    requestHash: string;
    correlationId: string;
  }): Promise<void>;
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
export class SavedAddressNotFoundError extends Error {
  readonly code = "ADDRESS_NOT_FOUND" as const;
}
export class SavedAddressRevisionConflictError extends Error {
  readonly code = "ADDRESS_REVISION_CONFLICT" as const;
  constructor(readonly current?: SavedAddress) {
    super("Saved address revision does not match");
  }
}
export class SavedAddressIdempotencyConflictError extends Error {
  readonly code = "IDEMPOTENCY_CONFLICT" as const;
}
