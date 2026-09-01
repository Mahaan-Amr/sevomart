import { createHash, randomUUID } from "node:crypto";

import {
  checkoutPreparationContract,
  buyerOrderPageContract,
  buyerOrderSnapshotContract,
  checkoutOptionsContract,
  checkoutRevisionContract,
  createOrderInputContract,
  directSettlementDisclosure,
  prepareCheckoutInputContract,
  reservationIdContract,
  type CheckoutChange,
  type CheckoutPreparation,
  type CreateOrderInput,
  type PrepareCheckoutInput,
} from "@sevo/contracts/orders/v1";
import {
  identityIdContract,
  orderIdContract,
  type IdentityId,
} from "@sevo/contracts/platform/v1";

import type { InventoryAuthoring } from "../../inventory/public";
import type { ProductAuthoritativeRead } from "../../product/public";
import type { StoreAuthoritativeRead } from "../../store/public";
import {
  CheckoutAddressInvalidError,
  CheckoutChangedError,
  CheckoutNotReadyError,
  CheckoutRevisionExpiredError,
  CheckoutShippingUnavailableError,
  type CartRepository,
  type CheckoutRepository,
  type SavedAddressRepository,
} from "../public";

const CHECKOUT_LIFETIME_MS = 10 * 60 * 1_000;
const RESERVATION_LIFETIME_MS = 15 * 60 * 1_000;

export class CheckoutService {
  constructor(
    private readonly repository: CheckoutRepository,
    private readonly carts: CartRepository,
    private readonly addresses: SavedAddressRepository,
    private readonly products: ProductAuthoritativeRead,
    private readonly inventory: InventoryAuthoring,
    private readonly stores: StoreAuthoritativeRead,
  ) {}

  async listBuyerOrders(identity: string) {
    const result = await this.repository.listBuyerOrders(
      identityIdContract.parse(identity),
    );
    return buyerOrderPageContract.parse(result);
  }

  async readBuyerOrder(identity: string, order: string) {
    const result = await this.repository.readBuyerOrder(
      identityIdContract.parse(identity),
      orderIdContract.parse(order),
    );
    return result ? buyerOrderSnapshotContract.parse(result) : undefined;
  }

  async options(identity: string) {
    await this.repository.expirePendingOrders?.(new Date());
    const identityId = identityIdContract.parse(identity);
    const cart = await this.carts.readBuyer(identityId);
    if (!cart?.items.length) throw new CheckoutNotReadyError();
    const store = await this.stores.readStore(cart.storeId);
    if (
      store?.publicationStatus !== "PUBLISHED" ||
      !store.returnPolicy ||
      store.settlement?.mode !== "DIRECT" ||
      store.settlement.status !== "TEST_VERIFIED" ||
      !store.shippingMethods.some((method) => method.enabled)
    ) {
      throw new CheckoutNotReadyError();
    }
    return checkoutOptionsContract.parse({
      cart: { cartId: cart.cartId, revision: cart.revision },
      shippingMethods: store.shippingMethods
        .filter((method) => method.enabled)
        .map((method) => ({
          id: method.id,
          revision: method.revision,
          code: method.code,
          label: method.label,
          fee: method.fixedFee,
          estimatedDeliveryText: method.estimatedDeliveryText,
          requiresDeliveryAddress: method.requiresDeliveryAddress,
        })),
      addresses: await this.addresses.list(identityId),
    });
  }

  async prepare(identity: string, rawInput: PrepareCheckoutInput) {
    await this.repository.expirePendingOrders?.(new Date());
    const identityId = identityIdContract.parse(identity);
    const input = prepareCheckoutInputContract.parse(rawInput);
    const cart = await this.carts.readBuyer(identityId);
    if (!cart || cart.cartId !== input.cartId || cart.items.length === 0) {
      throw new CheckoutNotReadyError();
    }
    if (cart.revision !== input.cartRevision) {
      throw new CheckoutChangedError([
        { kind: "QUANTITY_CHANGED", variantId: cart.items[0]!.variantId },
      ]);
    }

    const store = await this.stores.readStore(cart.storeId);
    if (
      store?.publicationStatus !== "PUBLISHED" ||
      !store.returnPolicy ||
      store.settlement?.mode !== "DIRECT" ||
      store.settlement.status !== "TEST_VERIFIED"
    ) {
      throw new CheckoutNotReadyError();
    }
    const shipping = store.shippingMethods.find(
      (method) => method.id === input.shippingMethodId,
    );
    if (
      !shipping?.enabled ||
      shipping.revision !== input.shippingMethodRevision ||
      shipping.fixedFee.currency !== "IRR"
    ) {
      throw new CheckoutShippingUnavailableError();
    }

    let address:
      | {
          addressId: string;
          revision: number;
          recipientName: string;
          recipientMobile: string;
          provinceText: string;
          cityText: string;
          addressLine: string;
          postalCode?: string;
        }
      | undefined;
    if (shipping.requiresDeliveryAddress) {
      const selected = (await this.addresses.list(identityId)).find(
        (candidate) => candidate.addressId === input.savedAddressId,
      );
      if (
        !selected ||
        selected.revision !== input.addressRevision ||
        (shipping.requiresPostalCode && !selected.postalCode)
      ) {
        throw new CheckoutAddressInvalidError();
      }
      address = selected;
    }

    const products = await Promise.all(
      cart.items.map((item) => this.products.readAuthoritativeVariant(item.variantId)),
    );
    const stock = new Map(
      (await this.inventory.readMany(cart.items.map((item) => item.variantId))).map(
        (item) => [item.variantId, item],
      ),
    );
    const items = cart.items.map((cartItem, index) => {
      const product = products[index];
      if (
        !product?.sellable ||
        product.storeId !== cart.storeId ||
        (stock.get(cartItem.variantId)?.available ?? 0) < cartItem.quantity
      ) {
        throw new CheckoutChangedError([
          { kind: "VARIANT_UNAVAILABLE", variantId: cartItem.variantId },
        ]);
      }
      assertRial(product.unitPrice.amount);
      return {
        productId: product.productId,
        variantId: product.variantId,
        name: product.name,
        quantity: cartItem.quantity,
        publicationVersion: product.publicationVersion,
        unitPrice: product.unitPrice,
        lineTotal: {
          amount: product.unitPrice.amount * cartItem.quantity,
          currency: "IRR" as const,
        },
      };
    });
    const subtotal = items.reduce((sum, item) => sum + item.lineTotal.amount, 0);
    const total = subtotal + shipping.fixedFee.amount;
    assertRial(total);
    const preparation = checkoutPreparationContract.parse({
      checkoutRevision: checkoutRevisionContract.parse(randomUUID()),
      expiresAt: new Date(Date.now() + CHECKOUT_LIFETIME_MS).toISOString(),
      cart: { cartId: cart.cartId, revision: cart.revision },
      store: {
        storeId: cart.storeId,
        name: store.displayIdentity.name ?? "فروشگاه",
      },
      items,
      ...(address ? { address } : {}),
      shippingMethod: {
        id: shipping.id,
        revision: shipping.revision,
        code: shipping.code,
        label: shipping.label,
        fee: shipping.fixedFee,
        estimatedDeliveryText: shipping.estimatedDeliveryText,
        requiresDeliveryAddress: shipping.requiresDeliveryAddress,
      },
      returnPolicy: store.returnPolicy,
      subtotal: { amount: subtotal, currency: "IRR" },
      total: { amount: total, currency: "IRR" },
      settlement: { mode: "DIRECT", disclosure: directSettlementDisclosure },
    });
    return this.repository.savePreparation({ identityId, input, preparation });
  }

  async createOrder(
    identity: string,
    rawInput: CreateOrderInput,
    idempotencyKey: string,
    correlationId: string,
  ) {
    const identityId = identityIdContract.parse(identity);
    const input = createOrderInputContract.parse(rawInput);
    const requestHash = hash(input);
    const replay = await this.repository.replayOrder?.(
      identityId,
      idempotencyKey,
      requestHash,
    );
    if (replay) return replay;
    await this.repository.expirePendingOrders?.(new Date());
    const preparation = await this.repository.readPreparation(
      identityId,
      input.checkoutRevision,
    );
    if (!preparation || Date.parse(preparation.expiresAt) <= Date.now()) {
      throw new CheckoutRevisionExpiredError();
    }
    const changes = await this.findChanges(identityId, preparation, input);
    if (changes.length) throw new CheckoutChangedError(changes);
    const reservationExpiresAt = new Date(Date.now() + RESERVATION_LIFETIME_MS);
    return this.repository.createOrder({
      identityId,
      orderId: orderIdContract.parse(randomUUID()),
      reservationId: reservationIdContract.parse(randomUUID()),
      input,
      idempotencyKey,
      requestHash,
      correlationId,
      reservationExpiresAt,
    });
  }

  private async findChanges(
    identityId: IdentityId,
    preparation: CheckoutPreparation,
    input: CreateOrderInput,
  ): Promise<CheckoutChange[]> {
    const changes: CheckoutChange[] = [];
    const cart = await this.carts.readBuyer(identityId);
    if (
      !cart ||
      input.cartRevision !== preparation.cart.revision ||
      cart.revision !== preparation.cart.revision
    ) {
      return preparation.items.map((item) => ({
        kind: "QUANTITY_CHANGED" as const,
        variantId: item.variantId,
      }));
    }
    const [store, products, stocks, addresses] = await Promise.all([
      this.stores.readStore(preparation.store.storeId),
      Promise.all(
        preparation.items.map((item) =>
          this.products.readAuthoritativeVariant(item.variantId),
        ),
      ),
      this.inventory.readMany(preparation.items.map((item) => item.variantId)),
      preparation.address ? this.addresses.list(identityId) : Promise.resolve([]),
    ]);
    const stock = new Map(stocks.map((item) => [item.variantId, item]));
    preparation.items.forEach((item, index) => {
      const current = products[index];
      if (
        !current?.sellable ||
        (stock.get(item.variantId)?.available ?? 0) < item.quantity
      ) {
        changes.push({ kind: "VARIANT_UNAVAILABLE", variantId: item.variantId });
      } else if (current.unitPrice.amount !== item.unitPrice.amount) {
        changes.push({
          kind: "PRICE_CHANGED",
          variantId: item.variantId,
          previous: item.unitPrice,
          current: current.unitPrice,
        });
      } else if (current.publicationVersion !== item.publicationVersion) {
        changes.push({ kind: "VARIANT_UNAVAILABLE", variantId: item.variantId });
      }
    });
    const shipping = store?.shippingMethods.find(
      (method) => method.id === preparation.shippingMethod.id,
    );
    if (
      !shipping?.enabled ||
      input.shippingMethodRevision !== preparation.shippingMethod.revision ||
      shipping.revision !== preparation.shippingMethod.revision
    ) {
      changes.push({ kind: "SHIPPING_METHOD_CHANGED" });
    } else if (shipping.fixedFee.amount !== preparation.shippingMethod.fee.amount) {
      changes.push({ kind: "SHIPPING_FEE_CHANGED" });
    }
    if (
      input.returnPolicyRevision !== preparation.returnPolicy.revision ||
      store?.returnPolicy?.revision !== preparation.returnPolicy.revision
    ) {
      changes.push({ kind: "POLICY_CHANGED" });
    }
    if (
      preparation.address &&
      !addresses.some(
        (address) =>
          address.addressId === preparation.address!.addressId &&
          input.addressRevision === preparation.address!.revision &&
          address.revision === preparation.address!.revision,
      )
    ) {
      changes.push({ kind: "ADDRESS_CHANGED" });
    }
    return changes;
  }
}

function assertRial(amount: number) {
  if (!Number.isSafeInteger(amount) || amount < 0 || amount % 10 !== 0) {
    throw new CheckoutNotReadyError();
  }
}

function hash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
