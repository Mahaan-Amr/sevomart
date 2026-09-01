import { createHash } from "node:crypto";

import {
  sellerInventoryListContract,
  type ReplaceSellerInventoryBatch,
} from "@sevo/contracts/inventory/v1";
import {
  identityIdContract,
  type IdentityId,
  type VariantId,
} from "@sevo/contracts/platform/v1";

import type { SellerAccessRead } from "../../identity-access/public";
import type {
  OpaqueProductTransactionContext,
  ProductAuthoritativeRead,
} from "../../product/public";
import type { StoreAuthoritativeRead } from "../../store/public";
import {
  InventoryNotFoundError,
  InventorySellerAccessInactiveError,
  type SellerInventoryRepository,
} from "../public";
import type { InventoryTransactionContext } from "../public";

export class SellerInventoryService {
  constructor(
    private readonly inventory: SellerInventoryRepository,
    private readonly products: ProductAuthoritativeRead,
    private readonly stores: StoreAuthoritativeRead,
    private readonly sellerAccess: SellerAccessRead,
    private readonly createProductTransactionContext: (
      transaction: InventoryTransactionContext,
    ) => OpaqueProductTransactionContext,
  ) {}

  async list(
    rawIdentityId: string,
    query: Readonly<{
      cursor?: VariantId;
      limit: number;
      availability?: "AVAILABLE" | "OUT_OF_STOCK";
    }>,
  ) {
    const { identityId, storeId } = await this.#requireOwnedStore(rawIdentityId);
    void identityId;
    const rows = await this.inventory.listForStore({
      storeId,
      ...query,
      limit: query.limit,
    });
    const pageRows = rows.slice(0, query.limit);
    const items = [];
    for (const row of pageRows) {
      const product = await this.products.readAuthoritativeVariant(row.variantId);
      if (!product || product.storeId !== storeId) continue;
      items.push({
        productId: product.productId,
        productName: product.name,
        ...row,
        availability: row.available > 0 ? "AVAILABLE" : "OUT_OF_STOCK",
      });
    }
    return sellerInventoryListContract.parse({
      items,
      nextCursor: rows.length > query.limit ? pageRows.at(-1)!.variantId : null,
    });
  }

  async replaceBatch(
    rawIdentityId: string,
    input: ReplaceSellerInventoryBatch,
    write: Readonly<{
      idempotencyKey: string;
      correlationId: string;
    }>,
  ) {
    const { identityId, storeId } = await this.#requireOwnedStore(rawIdentityId);
    return this.inventory.replaceSellerBatch({
      storeId,
      actorId: identityId,
      correlationId: write.correlationId,
      causationId: write.correlationId,
      idempotencyKey: write.idempotencyKey,
      requestHash: createHash("sha256").update(JSON.stringify(input)).digest("hex"),
      input,
      readPublication: async (transaction, variantId) => {
        const readInTransaction = this.products.readAuthoritativeVariantInTransaction;
        if (!readInTransaction) {
          throw new Error(
            "Product authoritative reads must support the inventory transaction",
          );
        }
        return readInTransaction.call(
          this.products,
          this.createProductTransactionContext(transaction),
          variantId,
        );
      },
    });
  }

  async #requireOwnedStore(rawIdentityId: string) {
    const identityId: IdentityId = identityIdContract.parse(rawIdentityId);
    if (!(await this.sellerAccess.isActiveSeller(identityId))) {
      throw new InventorySellerAccessInactiveError();
    }
    const store = await this.stores.readOwnedStore(identityId);
    if (!store) throw new InventoryNotFoundError();
    return { identityId, storeId: store.storeId };
  }
}
