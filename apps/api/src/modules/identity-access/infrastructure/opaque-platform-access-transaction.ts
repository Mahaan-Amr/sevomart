import type { Sql } from "postgres";

import type { OpaquePlatformAccessTransactionContext } from "../public";

const transactions = new WeakMap<OpaquePlatformAccessTransactionContext, Sql>();

export function createOpaquePlatformAccessTransactionContext(
  transaction: Sql,
): OpaquePlatformAccessTransactionContext {
  const context: OpaquePlatformAccessTransactionContext = Object.freeze({
    kind: "opaque-platform-access-transaction",
  });
  transactions.set(context, transaction);
  return context;
}

export function readOpaquePlatformAccessTransaction(
  context: OpaquePlatformAccessTransactionContext,
): Sql {
  const transaction = transactions.get(context);
  if (!transaction) throw new Error("Platform access transaction is invalid");
  return transaction;
}
