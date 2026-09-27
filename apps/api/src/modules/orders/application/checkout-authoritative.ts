import { checkoutPreparationContract } from "@sevo/contracts/orders/v1";
import type { IdentityId } from "@sevo/contracts/platform/v1";
import type { Sql } from "postgres";

import type {
  OpaqueProductTransactionContext,
  ProductAuthoritativeRead,
} from "../../product/public";
import type {
  OpaqueStoreTransactionContext,
  StoreAuthoritativeRead,
} from "../../store/public";
import { CheckoutChangedError } from "../public";

export async function assertAuthoritativeReview(
  sql: Sql,
  review: ReturnType<typeof checkoutPreparationContract.parse>,
  products: ProductAuthoritativeRead | undefined,
  stores: StoreAuthoritativeRead | undefined,
  createProductTransactionContext:
    ((transaction: Sql) => OpaqueProductTransactionContext) | undefined,
  createStoreTransactionContext:
    ((transaction: Sql) => OpaqueStoreTransactionContext) | undefined,
) {
  if (
    !products?.readAuthoritativeVariantInTransaction ||
    !stores?.readStoreInTransaction ||
    !createProductTransactionContext ||
    !createStoreTransactionContext
  ) {
    throw new Error("Transactional checkout readers are not configured");
  }
  const changes: CheckoutChangedError["changes"] = [];
  const store = await stores.readStoreInTransaction(
    createStoreTransactionContext(sql),
    review.store.storeId,
  );
  const shipping = store?.shippingMethods.find(
    (method) => method.id === review.shippingMethod.id,
  );
  if (
    !store ||
    store.publicationStatus !== "PUBLISHED" ||
    store.settlement?.mode !== "DIRECT" ||
    store.settlement.status !== "TEST_VERIFIED"
  ) {
    changes.push({ kind: "POLICY_CHANGED" });
  } else {
    if (
      store.returnPolicy?.revision !== review.returnPolicy.revision ||
      store.returnPolicy.text !== review.returnPolicy.text
    ) {
      changes.push({ kind: "POLICY_CHANGED" });
    }
    if (
      !shipping?.enabled ||
      shipping.revision !== review.shippingMethod.revision ||
      shipping.fixedFee.currency !== "IRR"
    ) {
      changes.push({ kind: "SHIPPING_METHOD_CHANGED" });
    } else if (shipping.fixedFee.amount !== review.shippingMethod.fee.amount) {
      changes.push({ kind: "SHIPPING_FEE_CHANGED" });
    }
  }

  const productTransaction = createProductTransactionContext(sql);
  for (const item of review.items) {
    const product = await products.readAuthoritativeVariantInTransaction(
      productTransaction,
      item.variantId,
    );
    if (
      !product ||
      !product.sellable ||
      product.storeId !== review.store.storeId ||
      product.productId !== item.productId ||
      product.publicationVersion !== item.publicationVersion ||
      product.unitPrice.currency !== "IRR"
    ) {
      changes.push({ kind: "VARIANT_UNAVAILABLE", variantId: item.variantId });
    } else if (product.unitPrice.amount !== item.unitPrice.amount) {
      changes.push({
        kind: "PRICE_CHANGED",
        variantId: item.variantId,
        previous: item.unitPrice,
        current: product.unitPrice,
      });
    }
  }
  if (changes.length) throw new CheckoutChangedError(changes);
}

export async function readAddress(
  sql: Sql,
  identityId: IdentityId,
  addressId: string,
  revision: number | undefined,
) {
  if (!revision) return undefined;
  const rows = await sql<
    Array<{
      recipientName: string;
      recipientMobile: string;
      provinceText: string;
      cityText: string;
      addressLine: string;
      postalCode: string | null;
    }>
  >`
    select revision.recipient_name as "recipientName",
      revision.recipient_mobile as "recipientMobile",
      revision.province_text as "provinceText", revision.city_text as "cityText",
      revision.address_line as "addressLine", revision.postal_code as "postalCode"
    from order_saved_addresses address
    join order_saved_address_revisions revision
      on revision.address_id = address.id and revision.revision = ${revision}
    where address.id = ${addressId} and address.identity_id = ${identityId}
      and address.status = 'ACTIVE' and address.current_revision = ${revision}
    for update of address
  `;
  return rows[0];
}
