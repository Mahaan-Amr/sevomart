import type { Sql } from "postgres";

import type { OpaqueProductTransactionContext } from "../public";

const transactions = new WeakMap<OpaqueProductTransactionContext, Sql>();

export function createOpaqueProductTransactionContext(
  transaction: Sql,
): OpaqueProductTransactionContext {
  const context: OpaqueProductTransactionContext = Object.freeze({
    kind: "opaque-product-transaction",
  });
  transactions.set(context, transaction);
  return context;
}

export function readOpaqueProductTransaction(
  context: OpaqueProductTransactionContext,
): Sql {
  const transaction = transactions.get(context);
  if (!transaction) throw new Error("Product transaction is invalid");
  return transaction;
}
