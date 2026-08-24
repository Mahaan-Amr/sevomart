import type { Sql } from "postgres";

import type { OpaqueStoreTransactionContext } from "../public";

const transactions = new WeakMap<OpaqueStoreTransactionContext, Sql>();

export function createOpaqueStoreTransactionContext(
  transaction: Sql,
): OpaqueStoreTransactionContext {
  const context: OpaqueStoreTransactionContext = Object.freeze({
    kind: "opaque-store-transaction",
  });
  transactions.set(context, transaction);
  return context;
}

export function readOpaqueStoreTransaction(
  context: OpaqueStoreTransactionContext,
): Sql {
  const transaction = transactions.get(context);
  if (!transaction) throw new Error("Approved seller store transaction is invalid");
  return transaction;
}
