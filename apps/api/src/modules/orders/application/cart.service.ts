import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";

import {
  cartContract,
  type AttachCartInput,
  type Cart,
  type CartConflict,
  type CartItemRemovalInput,
  type CartMutationInput,
  type CartReviewInput,
  type CartReviewChange,
  type ReplaceCartStoreInput,
} from "@sevo/contracts/orders/v1";
import { cartIdContract, cartIdempotencyKeyContract } from "@sevo/contracts/orders/v1";
import {
  identityIdContract,
  variantIdContract,
  type IdentityId,
  type StoreId,
} from "@sevo/contracts/platform/v1";

import type { InventoryAuthoring } from "../../inventory/public";
import type { ProductAuthoritativeRead } from "../../product/public";
import type { StoreAuthoritativeRead } from "../../store/public";
import {
  CartResolutionRequiredError,
  CartRevisionConflictError,
  CartStoreReplacementRequiredError,
  CartVariantUnavailableError,
  type CartAttachmentResult,
  type CartReadResult,
  type CartRepository,
  type CartReviewSnapshot,
  type StoredCart,
} from "../public";

const CART_LIFETIME_MS = 30 * 24 * 60 * 60 * 1_000;

export class CartService {
  constructor(
    private readonly repository: CartRepository,
    private readonly products: ProductAuthoritativeRead,
    private readonly inventory: InventoryAuthoring,
    private readonly stores: StoreAuthoritativeRead,
    private readonly tokenDerivationSecret = "sevo_test_cart_token_derivation_secret",
  ) {}

  async read(
    identityId: string | undefined,
    guestSecret: string | undefined,
  ): Promise<CartReadResult> {
    const actor = identityId ? identityIdContract.parse(identityId) : undefined;
    const tokenHash = hashSecret(guestSecret ?? "");
    const guest = guestSecret ? await this.repository.readGuest(tokenHash) : undefined;
    const buyer = actor ? await this.repository.readBuyer(actor) : undefined;
    const stored = buyer ?? guest;
    return { cart: stored ? await this.toCart(stored, Boolean(buyer && guest)) : null };
  }

  present(stored: StoredCart) {
    return this.toCart(stored, false);
  }

  async mutate(
    identityId: string | undefined,
    guestSecret: string | undefined,
    input: CartMutationInput,
    idempotencyKey: string,
    correlationId: string,
    guestScope?: string,
  ): Promise<{ cart: Cart; guestSecret?: string }> {
    const actor = identityId ? identityIdContract.parse(identityId) : undefined;
    const parsedKey = cartIdempotencyKeyContract.parse(idempotencyKey);
    const hash = requestHash(input);
    const scope = guestSecret
      ? hashSecret(guestSecret)
      : (actor ?? `new:${hashSecret(guestScope!)}`);
    const suppliedGuest = guestSecret
      ? await this.repository.readGuest(hashSecret(guestSecret))
      : undefined;
    const derivationScope =
      guestScope ?? (guestSecret ? hashSecret(guestSecret) : actor!);
    const candidateSecret =
      suppliedGuest && guestSecret
        ? guestSecret
        : deriveNewGuestSecret(this.tokenDerivationSecret, derivationScope, parsedKey);
    return this.runWithFailureReplay(
      {
        operation: "MUTATE_CART_RESPONSE",
        scope,
        idempotencyKey: parsedKey,
        requestHash: hash,
        correlationId,
      },
      () => this.read(identityId, guestSecret).then((result) => result.cart),
      async () => {
        const variantId = variantIdContract.parse(input.variantId);
        const authoritative = await this.products.readAuthoritativeVariant(variantId);
        if (!authoritative?.sellable) throw new CartVariantUnavailableError();
        const nextStore = await this.stores.readStore(authoritative.storeId);
        if (nextStore?.publicationStatus !== "PUBLISHED")
          throw new CartVariantUnavailableError();
        const stock = await this.inventory.read(variantId);
        if (!stock || stock.onHand < input.quantity)
          throw new CartVariantUnavailableError();

        const existingGuest = suppliedGuest;
        const existingBuyer = actor
          ? await this.repository.readBuyer(actor)
          : undefined;
        if (
          existingGuest &&
          existingBuyer &&
          existingGuest.cartId !== existingBuyer.cartId
        ) {
          throw new CartResolutionRequiredError();
        }
        const selected = existingGuest ?? existingBuyer;
        if (selected && selected.storeId !== authoritative.storeId) {
          const currentStore = await this.stores.readStore(selected.storeId);
          throw new CartStoreReplacementRequiredError(
            selected.storeId,
            authoritative.storeId,
            currentStore?.displayIdentity.name,
            nextStore.displayIdentity.name,
            selected.items.length,
          );
        }
        const reusableGuestSecret = existingGuest ? guestSecret : undefined;
        const newSecret = reusableGuestSecret ?? candidateSecret;
        const stored = await this.repository.mutate({
          ...(actor && !existingGuest ? { identityId: actor } : {}),
          guestTokenHash: hashSecret(newSecret),
          newCartId: cartIdContract.parse(randomUUID()),
          newAccessTokenId: randomUUID(),
          storeId: authoritative.storeId,
          productId: authoritative.productId,
          variantId,
          quantity: input.quantity,
          expectedRevision: input.expectedRevision,
          idempotencyKey: parsedKey,
          requestHash: hash,
          correlationId,
          reviewSnapshot: this.reviewSnapshot(nextStore, [authoritative]),
          expiresAt: new Date(Date.now() + CART_LIFETIME_MS),
        });
        return {
          cart: await this.toCart(stored, false),
          ...(!actor && !reusableGuestSecret ? { guestSecret: newSecret } : {}),
        };
      },
      {
        encode: (result) => ({ cart: result.cart }),
        decode: (value) => {
          const stored = value as { cart?: unknown };
          return {
            cart: cartContract.parse(stored.cart),
            ...(!actor && !suppliedGuest ? { guestSecret: candidateSecret } : {}),
          };
        },
      },
    );
  }

  async removeItem(
    identityId: string | undefined,
    guestSecret: string | undefined,
    variantId: string,
    input: CartItemRemovalInput,
    idempotencyKey: string,
    correlationId: string,
  ): Promise<Cart> {
    const actor = identityId ? identityIdContract.parse(identityId) : undefined;
    const parsedKey = cartIdempotencyKeyContract.parse(idempotencyKey);
    const hash = requestHash({ variantId, ...input });
    return this.runWithFailureReplay(
      {
        operation: "REMOVE_CART_ITEM_RESPONSE",
        scope: actor ?? hashSecret(guestSecret ?? ""),
        idempotencyKey: parsedKey,
        requestHash: hash,
        correlationId,
      },
      () => this.read(identityId, guestSecret).then((result) => result.cart),
      async () => {
        const stored = await this.repository.removeItem({
          ...(actor ? { identityId: actor } : {}),
          guestTokenHash: hashSecret(guestSecret ?? ""),
          variantId: variantIdContract.parse(variantId),
          expectedRevision: input.expectedRevision,
          idempotencyKey: parsedKey,
          requestHash: hash,
          correlationId,
        });
        return this.toCart(stored, false);
      },
    );
  }

  async confirmReview(
    identityId: string | undefined,
    guestSecret: string | undefined,
    input: CartReviewInput,
    idempotencyKey: string,
    correlationId: string,
  ): Promise<Cart> {
    const actor = identityId ? identityIdContract.parse(identityId) : undefined;
    const parsedKey = cartIdempotencyKeyContract.parse(idempotencyKey);
    const hash = requestHash(input);
    return this.runWithFailureReplay(
      {
        operation: "CONFIRM_CART_REVIEW_RESPONSE",
        scope: actor ?? hashSecret(guestSecret ?? ""),
        idempotencyKey: parsedKey,
        requestHash: hash,
        correlationId,
      },
      () => this.read(identityId, guestSecret).then((result) => result.cart),
      async () => {
        const stored = actor
          ? await this.repository.readBuyer(actor)
          : guestSecret
            ? await this.repository.readGuest(hashSecret(guestSecret))
            : undefined;
        if (!stored) throw new CartRevisionConflictError();
        const [store, ...products] = await Promise.all([
          this.stores.readStore(stored.storeId),
          ...stored.items.map((item) =>
            this.products.readAuthoritativeVariant(item.variantId),
          ),
        ]);
        if (!store || products.some((product) => !product)) {
          throw new CartVariantUnavailableError();
        }
        const availableProducts = products as Array<
          NonNullable<(typeof products)[number]>
        >;
        const reviewSnapshot = this.reviewSnapshot(store, availableProducts);
        const reviewed = await this.repository.confirmReview({
          ...(actor ? { identityId: actor } : {}),
          guestTokenHash: hashSecret(guestSecret ?? ""),
          expectedRevision: input.expectedRevision,
          idempotencyKey: parsedKey,
          requestHash: hash,
          correlationId,
          reviewSnapshot,
        });
        return this.toCart(reviewed, false);
      },
    );
  }

  async inspectAttachment(
    identityId: string,
    guestSecret: string | undefined,
    idempotencyKey: string,
    correlationId: string,
  ): Promise<CartAttachmentResult | { status: "EMPTY" }> {
    const actor = identityIdContract.parse(identityId);
    if (!guestSecret) {
      const buyer = await this.repository.readBuyer(actor);
      return buyer
        ? { status: "ATTACHED", cart: await this.toCart(buyer, false) }
        : { status: "EMPTY" };
    }
    const guestTokenHash = hashSecret(guestSecret);
    const result = await this.repository.inspectAttachment({
      identityId: actor,
      guestTokenHash,
      idempotencyKey: cartIdempotencyKeyContract.parse(idempotencyKey),
      requestHash: requestHash({ action: "ATTACH_CART", guestTokenHash }),
      correlationId,
    });
    if (result.status === "NONE") {
      return result.cart
        ? { status: "ATTACHED", cart: await this.toCart(result.cart, false) }
        : { status: "EMPTY" };
    }
    if (result.status === "ATTACHED") {
      return { status: "ATTACHED", cart: await this.toCart(result.cart, false) };
    }
    return {
      status: "RESOLUTION_REQUIRED",
      conflict: await this.toConflict(result.guest, result.buyer),
    };
  }

  async replaceStore(
    identityId: string | undefined,
    guestSecret: string | undefined,
    input: ReplaceCartStoreInput,
    idempotencyKey: string,
    correlationId: string,
  ): Promise<{ cart: Cart; guestSecret?: string }> {
    const actor = identityId ? identityIdContract.parse(identityId) : undefined;
    const parsedKey = cartIdempotencyKeyContract.parse(idempotencyKey);
    const hash = requestHash(input);
    return this.runWithFailureReplay(
      {
        operation: "REPLACE_CART_STORE_RESPONSE",
        scope: actor ?? hashSecret(guestSecret ?? ""),
        idempotencyKey: parsedKey,
        requestHash: hash,
        correlationId,
      },
      () => this.read(identityId, guestSecret).then((result) => result.cart),
      async () => {
        if (!actor && !guestSecret) throw new CartRevisionConflictError();
        const variantId = variantIdContract.parse(input.variantId);
        const authoritative = await this.products.readAuthoritativeVariant(variantId);
        const [stock, store] = await Promise.all([
          this.inventory.read(variantId),
          authoritative ? this.stores.readStore(authoritative.storeId) : undefined,
        ]);
        if (
          !authoritative?.sellable ||
          store?.publicationStatus !== "PUBLISHED" ||
          !stock ||
          stock.onHand < input.quantity
        ) {
          throw new CartVariantUnavailableError();
        }
        const replacementSecret = actor
          ? randomBytes(32).toString("base64url")
          : deriveReplacementSecret(guestSecret!, parsedKey);
        const stored = await this.repository.replaceStore({
          ...(actor ? { identityId: actor } : {}),
          guestTokenHash: hashSecret(guestSecret ?? ""),
          replacementTokenHash: hashSecret(replacementSecret),
          newCartId: cartIdContract.parse(randomUUID()),
          newAccessTokenId: randomUUID(),
          storeId: authoritative.storeId,
          productId: authoritative.productId,
          variantId,
          quantity: input.quantity,
          expectedRevision: input.expectedRevision,
          idempotencyKey: parsedKey,
          requestHash: hash,
          correlationId,
          reviewSnapshot: this.reviewSnapshot(store, [authoritative]),
          expiresAt: new Date(Date.now() + CART_LIFETIME_MS),
        });
        return {
          cart: await this.toCart(stored, false),
          ...(!actor ? { guestSecret: replacementSecret } : {}),
        };
      },
    );
  }

  async resolveAttachment(
    identityId: string,
    guestSecret: string | undefined,
    input: AttachCartInput,
    idempotencyKey: string,
    correlationId: string,
  ): Promise<CartAttachmentResult> {
    if (!guestSecret) throw new CartResolutionRequiredError();
    const stored = await this.repository.resolveAttachment({
      identityId: identityIdContract.parse(identityId),
      guestTokenHash: hashSecret(guestSecret),
      input,
      idempotencyKey: cartIdempotencyKeyContract.parse(idempotencyKey),
      requestHash: requestHash(input),
      correlationId,
    });
    return { status: "ATTACHED", cart: await this.toCart(stored, false) };
  }

  private async runWithFailureReplay<T>(
    command: {
      operation: string;
      scope: string;
      idempotencyKey: string;
      requestHash: string;
      correlationId: string;
    },
    readCurrentCart: () => Promise<Cart | null>,
    execute: () => Promise<T>,
    replay?: {
      encode: (result: T) => unknown;
      decode: (value: unknown) => T;
    },
  ): Promise<T> {
    if (replay && this.repository.replayResponse) {
      const stored = await this.repository.replayResponse(command);
      if (stored !== undefined) return replay.decode(stored);
    } else {
      await this.repository.replayFailure?.(command);
    }
    try {
      const result = await execute();
      if (replay) {
        await this.repository.recordResponse?.({
          ...command,
          response: replay.encode(result),
        });
      }
      return result;
    } catch (error) {
      let replayable = error;
      if (error instanceof CartRevisionConflictError) {
        try {
          const currentCart = error.current
            ? await this.toCart(error.current, false)
            : await readCurrentCart();
          replayable = new CartRevisionConflictError(error.current, currentCart);
        } catch (presentationError) {
          replayable = presentationError;
        }
      }
      await this.repository.recordFailure?.({ ...command, error: replayable });
      throw replayable;
    }
  }

  private async toCart(stored: StoredCart, requiresResolution: boolean): Promise<Cart> {
    const store = await this.stores.readStore(stored.storeId);
    if (!store?.displayIdentity.name) throw new CartVariantUnavailableError();
    const reviewChanges: CartReviewChange[] = [];
    if (stored.reviewedPolicyRevision !== (store.returnPolicy?.revision ?? 0)) {
      reviewChanges.push({
        kind: "POLICY_CHANGED",
        currentPolicyText:
          store.returnPolicy?.text ??
          "این فروشگاه اکنون سیاست مرجوعی ثبت‌شده‌ای ندارد.",
      });
    }
    if (stored.reviewedShippingHash !== shippingHash(store.shippingMethods)) {
      reviewChanges.push({
        kind: "SHIPPING_METHOD_CHANGED",
        currentMethods: store.shippingMethods.map((method) => ({
          label: method.label,
          fixedFee: method.fixedFee,
          estimatedDeliveryText: method.estimatedDeliveryText,
        })),
      });
    }
    const resolvedItems = await Promise.all(
      stored.items.map(async (item) => {
        const product = await this.products.readAuthoritativeVariant(item.variantId);
        if (!product) throw new CartVariantUnavailableError();
        const stock = await this.inventory.read(item.variantId);
        const itemChanges: CartReviewChange[] = [];
        if (item.reviewedPublicationVersion !== product.publicationVersion) {
          itemChanges.push({ kind: "PRODUCT_CHANGED", variantId: item.variantId });
        }
        if (item.reviewedUnitPriceAmount !== product.unitPrice.amount) {
          itemChanges.push({
            kind: "PRICE_CHANGED",
            variantId: item.variantId,
            previousUnitPrice: {
              amount: item.reviewedUnitPriceAmount,
              currency: "IRR" as const,
            },
            currentUnitPrice: product.unitPrice,
          });
        }
        const unavailable =
          !product.sellable ||
          store.publicationStatus !== "PUBLISHED" ||
          (stock?.onHand ?? 0) < item.quantity;
        if (unavailable) {
          itemChanges.push({
            kind: "VARIANT_UNAVAILABLE",
            variantId: item.variantId,
          });
        }
        return {
          changes: itemChanges,
          cartItem: {
            productId: product.productId,
            variantId: product.variantId,
            name: product.name,
            image: product.image,
            quantity: item.quantity,
            unitPrice: product.unitPrice,
            availability:
              !product.sellable || store.publicationStatus !== "PUBLISHED"
                ? ("UNAVAILABLE" as const)
                : (stock?.onHand ?? 0) >= item.quantity
                  ? ("AVAILABLE" as const)
                  : ("OUT_OF_STOCK" as const),
          },
        };
      }),
    );
    reviewChanges.push(...resolvedItems.flatMap((item) => item.changes));
    return cartContract.parse({
      cartId: stored.cartId,
      store: { storeId: stored.storeId, name: store.displayIdentity.name },
      revision: stored.revision,
      requiresResolution,
      reviewRequired: reviewChanges.length > 0,
      reviewChanges,
      items: resolvedItems.map((item) => item.cartItem),
    });
  }

  private async toConflict(
    guest: StoredCart,
    buyer: StoredCart,
  ): Promise<CartConflict> {
    const [guestStore, buyerStore] = await Promise.all([
      this.storeSummary(guest.storeId),
      this.storeSummary(buyer.storeId),
    ]);
    const summaries = {
      guest: {
        cartId: guest.cartId,
        storeName: guestStore,
        itemCount: guest.items.length,
        revision: guest.revision,
      },
      buyer: {
        cartId: buyer.cartId,
        storeName: buyerStore,
        itemCount: buyer.items.length,
        revision: buyer.revision,
      },
    };
    if (guest.storeId !== buyer.storeId) {
      return { kind: "DIFFERENT_STORE", ...summaries };
    }
    const variants = new Set([
      ...guest.items.map((item) => item.variantId),
      ...buyer.items.map((item) => item.variantId),
    ]);
    const combinedQuantities = await Promise.all(
      [...variants].map(async (variantId) => {
        const guestQuantity =
          guest.items.find((item) => item.variantId === variantId)?.quantity ?? 0;
        const buyerQuantity =
          buyer.items.find((item) => item.variantId === variantId)?.quantity ?? 0;
        const product = await this.products.readAuthoritativeVariant(variantId);
        return {
          variantId,
          name: product?.name ?? "کالای سبد",
          guestQuantity,
          buyerQuantity,
          mergedQuantity: guestQuantity + buyerQuantity,
        };
      }),
    );
    return {
      kind: "SAME_STORE",
      ...summaries,
      mergeAllowed: combinedQuantities.every((item) => item.mergedQuantity <= 99),
      combinedQuantities,
    };
  }

  private async storeSummary(storeId: StoreId) {
    return (await this.stores.readStore(storeId))?.displayIdentity.name ?? "فروشگاه";
  }

  private reviewSnapshot(
    store: NonNullable<Awaited<ReturnType<StoreAuthoritativeRead["readStore"]>>>,
    products: Array<
      NonNullable<
        Awaited<ReturnType<ProductAuthoritativeRead["readAuthoritativeVariant"]>>
      >
    >,
  ): CartReviewSnapshot {
    return {
      policyRevision: store.returnPolicy?.revision ?? 0,
      shippingHash: shippingHash(store.shippingMethods),
      items: products.map((product) => ({
        variantId: product.variantId,
        publicationVersion: product.publicationVersion,
        unitPriceAmount: product.unitPrice.amount,
      })),
    };
  }
}

export function hashSecret(secret: string) {
  return createHash("sha256").update(secret).digest("hex");
}

function requestHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function deriveReplacementSecret(guestSecret: string, idempotencyKey: string) {
  return createHmac("sha256", guestSecret)
    .update(`replace-store:${idempotencyKey}`)
    .digest("base64url");
}

function deriveNewGuestSecret(
  secret: string,
  guestScope: string,
  idempotencyKey: string,
) {
  return createHmac("sha256", secret)
    .update(`new-cart:${guestScope}:${idempotencyKey}`)
    .digest("base64url");
}

function shippingHash(
  value: ReadonlyArray<{ id: string; revision: number; enabled: boolean }>,
) {
  const canonical = [...value]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map(({ id, revision, enabled }) => ({ id, revision, enabled }));
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

export type CartActor = IdentityId | undefined;
