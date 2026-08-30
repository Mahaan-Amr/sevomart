import type {
  OrderConversationEligibilityInput,
  OrderPurchaseExperienceEligibilityDecision,
  OrderPurchaseExperienceEligibilityInput,
  AttachCartInput,
  Cart,
  CartConflict,
  CartId,
  CheckoutChange,
  CheckoutPreparation,
  CreateSavedAddressInput,
  CreateOrderInput,
  Order,
  OrderPaymentReviewReasonCode,
  OrderStatus,
  SellerActionableOrder,
  PrepareCheckoutInput,
  SavedAddress,
  SavedAddressId,
} from "@sevo/contracts/orders/v1";
import type {
  IdentityId,
  OrderId,
  PaymentAttemptId,
  ProductId,
  StoreId,
  VariantId,
} from "@sevo/contracts/platform/v1";

declare const orderPaymentTransactionContext: unique symbol;
export type OrderPaymentTransactionContext = {
  readonly [orderPaymentTransactionContext]: true;
};

export type PayableOrder = Readonly<{
  orderId: OrderId;
  reservationId: string;
  totalAmount: number;
  reservationExpiresAt: Date;
  status: OrderStatus;
}>;

export type PaymentResultOrder = PayableOrder &
  Readonly<{
    status: Extract<OrderStatus, "PENDING_PAYMENT" | "PAYMENT_REVIEW" | "EXPIRED">;
  }>;

export type BuyerPaymentState = Readonly<{
  status: OrderStatus;
  reservationExpiresAt: Date;
}>;

export interface OrderConversationEligibility {
  checkConversationOrder(input: OrderConversationEligibilityInput): Promise<boolean>;
}

export interface OrderPurchaseExperienceEligibilityRead {
  readPurchaseExperienceEligibility(
    input: OrderPurchaseExperienceEligibilityInput,
  ): Promise<OrderPurchaseExperienceEligibilityDecision>;
}

export interface OrderPaymentWorkflow {
  lockPaymentOrder(
    transaction: OrderPaymentTransactionContext,
    identityId: IdentityId,
    orderId: OrderId,
  ): Promise<PayableOrder | undefined>;
  lockPaymentResultOrder(
    transaction: OrderPaymentTransactionContext,
    identityId: IdentityId,
    orderId: OrderId,
  ): Promise<PaymentResultOrder | undefined>;
  readBuyerPaymentState(
    identityId: IdentityId,
    orderId: OrderId,
  ): Promise<BuyerPaymentState | undefined>;
  markPaid(
    transaction: OrderPaymentTransactionContext,
    command: {
      orderId: OrderId;
      attemptId: PaymentAttemptId;
      paidAt: Date;
      correlationId: string;
    },
  ): Promise<void>;
  markPaymentReview(
    transaction: OrderPaymentTransactionContext,
    command: {
      orderId: OrderId;
      attemptId: PaymentAttemptId;
      occurredAt: Date;
      correlationId: string;
      reasonCode: OrderPaymentReviewReasonCode;
    },
  ): Promise<void>;
  resolvePaymentFailure(
    transaction: OrderPaymentTransactionContext,
    command: {
      orderId: OrderId;
      attemptId: PaymentAttemptId;
      occurredAt: Date;
      correlationId: string;
    },
  ): Promise<Extract<OrderStatus, "PENDING_PAYMENT" | "EXPIRED">>;
  markPaidStockConflict(
    transaction: OrderPaymentTransactionContext,
    command: {
      orderId: OrderId;
      attemptId: PaymentAttemptId;
      occurredAt: Date;
      correlationId: string;
    },
  ): Promise<void>;
  listActionableByStore(storeId: StoreId): Promise<SellerActionableOrder[]>;
}

export function createOrderPaymentTransactionContext(
  transaction: unknown,
): OrderPaymentTransactionContext {
  return transaction as OrderPaymentTransactionContext;
}

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
  replayFailure?(command: {
    operation: string;
    scope: string;
    idempotencyKey: string;
    requestHash: string;
  }): Promise<void>;
  replayResponse?(command: {
    operation: string;
    scope: string;
    idempotencyKey: string;
    requestHash: string;
  }): Promise<unknown | undefined>;
  recordResponse?(command: {
    operation: string;
    scope: string;
    idempotencyKey: string;
    requestHash: string;
    response: unknown;
  }): Promise<void>;
  recordFailure?(command: {
    operation: string;
    scope: string;
    idempotencyKey: string;
    requestHash: string;
    correlationId: string;
    error: unknown;
  }): Promise<void>;
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

export interface CheckoutRepository {
  savePreparation(command: {
    identityId: IdentityId;
    input: PrepareCheckoutInput;
    preparation: CheckoutPreparation;
  }): Promise<CheckoutPreparation>;
  readPreparation(
    identityId: IdentityId,
    checkoutRevision: string,
  ): Promise<CheckoutPreparation | undefined>;
  replayOrder?(
    identityId: IdentityId,
    idempotencyKey: string,
    requestHash: string,
  ): Promise<Order | undefined>;
  createOrder(command: {
    identityId: IdentityId;
    orderId: string;
    reservationId: string;
    input: CreateOrderInput;
    idempotencyKey: string;
    requestHash: string;
    correlationId: string;
    reservationExpiresAt: Date;
  }): Promise<Order>;
  expirePendingOrders?(now: Date): Promise<number>;
}

export type CartReadResult = { cart: Cart | null };
export type CartAttachmentResult =
  | { status: "ATTACHED"; cart: Cart }
  | { status: "RESOLUTION_REQUIRED"; conflict: CartConflict };

export class CartRevisionConflictError extends Error {
  readonly code = "CART_REVISION_CONFLICT" as const;
  constructor(
    readonly current?: StoredCart,
    readonly currentCart?: Cart | null,
  ) {
    super("Cart revision does not match");
  }
}
export class CartIdempotencyConflictError extends Error {
  readonly code = "IDEMPOTENCY_CONFLICT" as const;
}
export class CartIdempotencyInProgressError extends Error {
  readonly code = "IDEMPOTENCY_IN_PROGRESS" as const;
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
export class SavedAddressIdempotencyInProgressError extends Error {
  readonly code = "IDEMPOTENCY_IN_PROGRESS" as const;
}

export class CheckoutChangedError extends Error {
  readonly code = "CART_CHANGED" as const;
  constructor(readonly changes: CheckoutChange[]) {
    super("Checkout inputs changed");
  }
}
export class CheckoutRevisionExpiredError extends Error {
  readonly code = "CHECKOUT_REVISION_EXPIRED" as const;
}
export class CheckoutNotReadyError extends Error {
  readonly code = "CHECKOUT_NOT_READY" as const;
}
export class CheckoutAddressInvalidError extends Error {
  readonly code = "ADDRESS_INVALID" as const;
}
export class CheckoutShippingUnavailableError extends Error {
  readonly code = "SHIPPING_METHOD_UNAVAILABLE" as const;
}
export class CheckoutIdempotencyConflictError extends Error {
  readonly code = "IDEMPOTENCY_CONFLICT" as const;
}
export class CheckoutIdempotencyInProgressError extends Error {
  readonly code = "IDEMPOTENCY_IN_PROGRESS" as const;
}
