import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";

import {
  cartContract,
  type AttachCartInput,
  type Cart,
  type CartConflict,
  type CartMutationInput,
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
import type { StoreRepository } from "../../store/public";
import {
  CartResolutionRequiredError,
  CartRevisionConflictError,
  CartStoreReplacementRequiredError,
  CartVariantUnavailableError,
  type CartAttachmentResult,
  type CartReadResult,
  type CartRepository,
  type StoredCart,
} from "../public";

const CART_LIFETIME_MS = 30 * 24 * 60 * 60 * 1_000;

export class CartService {
  constructor(
    private readonly repository: CartRepository,
    private readonly products: ProductAuthoritativeRead,
    private readonly inventory: InventoryAuthoring,
    private readonly stores: Pick<StoreRepository, "findById">,
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

  async mutate(
    identityId: string | undefined,
    guestSecret: string | undefined,
    input: CartMutationInput,
    idempotencyKey: string,
  ): Promise<{ cart: Cart; guestSecret?: string }> {
    const actor = identityId ? identityIdContract.parse(identityId) : undefined;
    const parsedKey = cartIdempotencyKeyContract.parse(idempotencyKey);
    const variantId = variantIdContract.parse(input.variantId);
    const authoritative = await this.products.readAuthoritativeVariant(variantId);
    if (!authoritative?.sellable) throw new CartVariantUnavailableError();
    const nextStore = await this.stores.findById(authoritative.storeId);
    if (nextStore?.status !== "PUBLISHED") throw new CartVariantUnavailableError();
    const stock = await this.inventory.read(variantId);
    if (!stock || stock.onHand < input.quantity)
      throw new CartVariantUnavailableError();

    const existingGuest = guestSecret
      ? await this.repository.readGuest(hashSecret(guestSecret))
      : undefined;
    const existingBuyer = actor ? await this.repository.readBuyer(actor) : undefined;
    if (
      existingGuest &&
      existingBuyer &&
      existingGuest.cartId !== existingBuyer.cartId
    ) {
      throw new CartResolutionRequiredError();
    }
    const selected = existingGuest ?? existingBuyer;
    if (selected && selected.storeId !== authoritative.storeId) {
      const currentStore = await this.stores.findById(selected.storeId);
      throw new CartStoreReplacementRequiredError(
        selected.storeId,
        authoritative.storeId,
        currentStore?.name,
        nextStore.name,
        selected.items.length,
      );
    }
    const reusableGuestSecret = existingGuest ? guestSecret : undefined;
    const newSecret = reusableGuestSecret ?? randomBytes(32).toString("base64url");
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
      requestHash: requestHash(input),
      expiresAt: new Date(Date.now() + CART_LIFETIME_MS),
    });
    return {
      cart: await this.toCart(stored, false),
      ...(!actor && !reusableGuestSecret ? { guestSecret: newSecret } : {}),
    };
  }

  async inspectAttachment(
    identityId: string,
    guestSecret: string | undefined,
  ): Promise<CartAttachmentResult | { status: "EMPTY" }> {
    const actor = identityIdContract.parse(identityId);
    if (!guestSecret) {
      const buyer = await this.repository.readBuyer(actor);
      return buyer
        ? { status: "ATTACHED", cart: await this.toCart(buyer, false) }
        : { status: "EMPTY" };
    }
    const result = await this.repository.inspectAttachment(
      actor,
      hashSecret(guestSecret),
    );
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
  ): Promise<{ cart: Cart; guestSecret?: string }> {
    const actor = identityId ? identityIdContract.parse(identityId) : undefined;
    if (!actor && !guestSecret) throw new CartRevisionConflictError();
    const variantId = variantIdContract.parse(input.variantId);
    const authoritative = await this.products.readAuthoritativeVariant(variantId);
    const [stock, store] = await Promise.all([
      this.inventory.read(variantId),
      authoritative ? this.stores.findById(authoritative.storeId) : undefined,
    ]);
    if (
      !authoritative?.sellable ||
      store?.status !== "PUBLISHED" ||
      !stock ||
      stock.onHand < input.quantity
    ) {
      throw new CartVariantUnavailableError();
    }
    const parsedKey = cartIdempotencyKeyContract.parse(idempotencyKey);
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
      requestHash: requestHash(input),
      expiresAt: new Date(Date.now() + CART_LIFETIME_MS),
    });
    return {
      cart: await this.toCart(stored, false),
      ...(!actor ? { guestSecret: replacementSecret } : {}),
    };
  }

  async resolveAttachment(
    identityId: string,
    guestSecret: string | undefined,
    input: AttachCartInput,
    idempotencyKey: string,
  ): Promise<CartAttachmentResult> {
    if (!guestSecret) throw new CartResolutionRequiredError();
    const stored = await this.repository.resolveAttachment({
      identityId: identityIdContract.parse(identityId),
      guestTokenHash: hashSecret(guestSecret),
      input,
      idempotencyKey: cartIdempotencyKeyContract.parse(idempotencyKey),
      requestHash: requestHash(input),
    });
    return { status: "ATTACHED", cart: await this.toCart(stored, false) };
  }

  private async toCart(stored: StoredCart, requiresResolution: boolean): Promise<Cart> {
    const store = await this.stores.findById(stored.storeId);
    if (!store?.name) throw new CartVariantUnavailableError();
    const items = await Promise.all(
      stored.items.map(async (item) => {
        const product = await this.products.readAuthoritativeVariant(item.variantId);
        if (!product) throw new CartVariantUnavailableError();
        const stock = await this.inventory.read(item.variantId);
        return {
          productId: product.productId,
          variantId: product.variantId,
          name: product.name,
          image: product.image,
          quantity: item.quantity,
          unitPrice: product.unitPrice,
          availability:
            !product.sellable || store.status !== "PUBLISHED"
              ? ("UNAVAILABLE" as const)
              : (stock?.onHand ?? 0) >= item.quantity
                ? ("AVAILABLE" as const)
                : ("OUT_OF_STOCK" as const),
        };
      }),
    );
    return cartContract.parse({
      cartId: stored.cartId,
      store: { storeId: stored.storeId, name: store.name },
      revision: stored.revision,
      requiresResolution,
      items,
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
    return {
      kind: "SAME_STORE",
      ...summaries,
      combinedQuantities: [...variants].map((variantId) => {
        const guestQuantity =
          guest.items.find((item) => item.variantId === variantId)?.quantity ?? 0;
        const buyerQuantity =
          buyer.items.find((item) => item.variantId === variantId)?.quantity ?? 0;
        return {
          variantId,
          guestQuantity,
          buyerQuantity,
          mergedQuantity: Math.min(99, guestQuantity + buyerQuantity),
        };
      }),
    };
  }

  private async storeSummary(storeId: StoreId) {
    return (await this.stores.findById(storeId))?.name ?? "فروشگاه";
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

export type CartActor = IdentityId | undefined;
