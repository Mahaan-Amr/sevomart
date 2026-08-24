import type { AttachCartInput } from "@sevo/contracts/orders/v1";
import { randomUUID } from "node:crypto";
import { cartIdContract, type CartId } from "@sevo/contracts/orders/v1";
import {
  identityIdContract,
  productIdContract,
  storeIdContract,
  variantIdContract,
  type IdentityId,
} from "@sevo/contracts/platform/v1";
import postgres, { type JSONValue, type Sql } from "postgres";

import {
  CartIdempotencyConflictError,
  CartQuantityLimitError,
  CartResolutionRequiredError,
  CartRevisionConflictError,
  CartStoreReplacementRequiredError,
  type CartMutationCommand,
  type CartRepository,
  type StoredCart,
} from "../public";

type CartRow = {
  cartId: string;
  storeId: string;
  identityId: string | null;
  revision: number;
  variantId: string | null;
  productId: string | null;
  quantity: number | null;
  reviewedPolicyRevision: number;
  reviewedShippingHash: string;
  reviewedPublicationVersion: number | null;
  reviewedUnitPriceAmount: number | null;
};

export class PostgresCartRepository implements CartRepository {
  readonly #sql: Sql;

  constructor(databaseUrl: string) {
    this.#sql = postgres(databaseUrl, { max: 5 });
  }

  readGuest(tokenHash: string) {
    return this.#readGuest(this.#sql, tokenHash);
  }

  readBuyer(identityId: IdentityId) {
    return this.#readBuyer(this.#sql, identityId);
  }

  async mutate(command: CartMutationCommand): Promise<StoredCart> {
    return this.#sql.begin(async (sql) => {
      const scope = command.identityId ?? command.guestTokenHash;
      await advisoryLock(sql, `cart-mutation:${scope}`);
      const replay = await this.#claimIdempotency(
        sql,
        "MUTATE_CART",
        scope,
        command.idempotencyKey,
        command.requestHash,
      );
      if (replay) return parseStoredCart(replay);

      const current = command.identityId
        ? await this.#readBuyer(sql, command.identityId, true)
        : await this.#readGuest(sql, command.guestTokenHash, true);
      let cartId: CartId;
      if (!current) {
        if (command.expectedRevision !== 0) throw new CartRevisionConflictError();
        if (command.identityId) {
          await sql`
            update order_carts set status = 'EXPIRED', identity_id = null,
              updated_at = now()
            where identity_id = ${command.identityId} and status = 'ACTIVE'
              and expires_at <= now()
          `;
        }
        cartId = command.newCartId;
        await sql`
          insert into order_carts
            (id, store_id, identity_id, status, revision,
             reviewed_policy_revision, reviewed_shipping_hash, expires_at, updated_at)
          values
            (${cartId}, ${command.storeId}, ${command.identityId ?? null},
             'ACTIVE', 0, ${command.reviewSnapshot.policyRevision},
             ${command.reviewSnapshot.shippingHash}, ${command.expiresAt}, now())
        `;
        if (!command.identityId) {
          await sql`
            insert into order_cart_access_tokens
              (id, cart_id, token_hash, expires_at)
            values
              (${command.newAccessTokenId}, ${cartId}, ${command.guestTokenHash},
               ${command.expiresAt})
          `;
        }
      } else {
        cartId = current.cartId;
        if (current.revision !== command.expectedRevision) {
          throw new CartRevisionConflictError();
        }
        if (current.storeId !== command.storeId) {
          throw new CartStoreReplacementRequiredError(current.storeId, command.storeId);
        }
      }

      const counts = await sql<Array<{ count: number }>>`
        select count(*)::int as count from order_cart_items where cart_id = ${cartId}
      `;
      const existing = await sql<Array<{ exists: boolean }>>`
        select exists (
          select 1 from order_cart_items
          where cart_id = ${cartId} and variant_id = ${command.variantId}
        ) as exists
      `;
      if ((counts[0]?.count ?? 0) >= 100 && !existing[0]?.exists) {
        throw new CartQuantityLimitError();
      }
      await sql`
        insert into order_cart_items
          (cart_id, variant_id, product_id, quantity,
           reviewed_publication_version, reviewed_unit_price_amount, updated_at)
        values
          (${cartId}, ${command.variantId}, ${command.productId},
           ${command.quantity},
           ${command.reviewSnapshot.items[0]?.publicationVersion ?? 0},
           ${command.reviewSnapshot.items[0]?.unitPriceAmount ?? 0}, now())
        on conflict (cart_id, variant_id) do update set
          quantity = excluded.quantity, product_id = excluded.product_id,
          updated_at = excluded.updated_at
      `;
      await sql`
        update order_carts set revision = revision + 1,
          expires_at = ${command.expiresAt}, updated_at = now()
        where id = ${cartId}
      `;
      const result = await this.#readById(sql, cartId);
      if (!result) throw new Error("Cart mutation did not persist a cart");
      await writeCartAudit(sql, command, cartId, result.revision, "UPSERT_ITEM");
      await this.#completeIdempotency(
        sql,
        "MUTATE_CART",
        scope,
        command.idempotencyKey,
        result,
      );
      return result;
    });
  }

  async removeItem(command: {
    identityId?: IdentityId;
    guestTokenHash: string;
    variantId: ReturnType<typeof variantIdContract.parse>;
    expectedRevision: number;
    idempotencyKey: string;
    requestHash: string;
    correlationId: string;
  }): Promise<StoredCart> {
    return this.#sql.begin(async (sql) => {
      const scope = command.identityId ?? command.guestTokenHash;
      await advisoryLock(sql, `cart-mutation:${scope}`);
      const replay = await this.#claimIdempotency(
        sql,
        "REMOVE_CART_ITEM",
        scope,
        command.idempotencyKey,
        command.requestHash,
      );
      if (replay) return parseStoredCart(replay);
      const current = command.identityId
        ? await this.#readBuyer(sql, command.identityId, true)
        : await this.#readGuest(sql, command.guestTokenHash, true);
      if (!current || current.revision !== command.expectedRevision) {
        throw new CartRevisionConflictError();
      }
      await sql`
        delete from order_cart_items
        where cart_id = ${current.cartId} and variant_id = ${command.variantId}
      `;
      await incrementRevision(sql, current.cartId);
      const result = await this.#readById(sql, current.cartId);
      if (!result) throw new Error("Cart was not found after item removal");
      await writeCartAudit(
        sql,
        command,
        current.cartId,
        result.revision,
        "REMOVE_ITEM",
      );
      await this.#completeIdempotency(
        sql,
        "REMOVE_CART_ITEM",
        scope,
        command.idempotencyKey,
        result,
      );
      return result;
    });
  }

  async confirmReview(command: {
    identityId?: IdentityId;
    guestTokenHash: string;
    expectedRevision: number;
    idempotencyKey: string;
    requestHash: string;
    correlationId: string;
    reviewSnapshot: import("../public").CartReviewSnapshot;
  }): Promise<StoredCart> {
    return this.#sql.begin(async (sql) => {
      const scope = command.identityId ?? command.guestTokenHash;
      await advisoryLock(sql, `cart-mutation:${scope}`);
      const replay = await this.#claimIdempotency(
        sql,
        "CONFIRM_CART_REVIEW",
        scope,
        command.idempotencyKey,
        command.requestHash,
      );
      if (replay) return parseStoredCart(replay);
      const current = command.identityId
        ? await this.#readBuyer(sql, command.identityId, true)
        : await this.#readGuest(sql, command.guestTokenHash, true);
      if (!current || current.revision !== command.expectedRevision) {
        throw new CartRevisionConflictError();
      }
      await sql`
        update order_carts set
          reviewed_policy_revision = ${command.reviewSnapshot.policyRevision},
          reviewed_shipping_hash = ${command.reviewSnapshot.shippingHash},
          revision = revision + 1, updated_at = now()
        where id = ${current.cartId}
      `;
      for (const item of command.reviewSnapshot.items) {
        await sql`
          update order_cart_items set
            reviewed_publication_version = ${item.publicationVersion},
            reviewed_unit_price_amount = ${item.unitPriceAmount}, updated_at = now()
          where cart_id = ${current.cartId} and variant_id = ${item.variantId}
        `;
      }
      const result = await this.#readById(sql, current.cartId);
      if (!result) throw new Error("Cart was not found after review");
      await writeCartAudit(
        sql,
        command,
        current.cartId,
        result.revision,
        "CONFIRM_REVIEW",
      );
      await this.#completeIdempotency(
        sql,
        "CONFIRM_CART_REVIEW",
        scope,
        command.idempotencyKey,
        result,
      );
      return result;
    });
  }

  async replaceStore(
    command: CartMutationCommand & {
      replacementTokenHash: string;
    },
  ): Promise<StoredCart> {
    return this.#sql.begin(async (sql) => {
      const scope = command.identityId ?? command.guestTokenHash;
      await advisoryLock(sql, `cart-mutation:${scope}`);
      const replay = await this.#claimIdempotency(
        sql,
        "REPLACE_CART_STORE",
        scope,
        command.idempotencyKey,
        command.requestHash,
      );
      if (replay) return parseStoredCart(replay);
      const current = command.identityId
        ? await this.#readBuyer(sql, command.identityId, true)
        : await this.#readGuest(sql, command.guestTokenHash, true);
      if (!current || current.revision !== command.expectedRevision) {
        throw new CartRevisionConflictError();
      }
      if (current.storeId === command.storeId) {
        throw new CartResolutionRequiredError();
      }
      await terminalize(sql, current.cartId, "REPLACED");
      await sql`
        insert into order_carts
          (id, store_id, identity_id, status, revision,
           reviewed_policy_revision, reviewed_shipping_hash, expires_at, updated_at)
        values
          (${command.newCartId}, ${command.storeId}, ${command.identityId ?? null},
           'ACTIVE', 1, ${command.reviewSnapshot.policyRevision},
           ${command.reviewSnapshot.shippingHash}, ${command.expiresAt}, now())
      `;
      await sql`
        insert into order_cart_items
          (cart_id, variant_id, product_id, quantity,
           reviewed_publication_version, reviewed_unit_price_amount, updated_at)
        values
          (${command.newCartId}, ${command.variantId}, ${command.productId},
           ${command.quantity},
           ${command.reviewSnapshot.items[0]?.publicationVersion ?? 0},
           ${command.reviewSnapshot.items[0]?.unitPriceAmount ?? 0}, now())
      `;
      if (!command.identityId) {
        await sql`
          insert into order_cart_access_tokens
            (id, cart_id, token_hash, expires_at)
          values
            (${command.newAccessTokenId}, ${command.newCartId},
             ${command.replacementTokenHash}, ${command.expiresAt})
        `;
      }
      const result = await this.#readById(sql, command.newCartId);
      if (!result) throw new Error("Replacement cart was not found");
      await writeCartAudit(
        sql,
        command,
        command.newCartId,
        result.revision,
        "REPLACE_STORE",
      );
      await this.#completeIdempotency(
        sql,
        "REPLACE_CART_STORE",
        scope,
        command.idempotencyKey,
        result,
      );
      return result;
    });
  }

  async inspectAttachment(command: {
    identityId: IdentityId;
    guestTokenHash: string;
    idempotencyKey: string;
    requestHash: string;
    correlationId: string;
  }) {
    return this.#sql.begin(async (sql) => {
      await advisoryLock(sql, `cart-attach:${command.identityId}`);
      const replay = await this.#readIdempotency(
        sql,
        "ATTACH_CART",
        command.identityId,
        command.idempotencyKey,
        command.requestHash,
      );
      if (replay) return { status: "ATTACHED" as const, cart: parseStoredCart(replay) };
      const guest = await this.#readGuest(sql, command.guestTokenHash, true);
      const buyer = await this.#readBuyer(sql, command.identityId, true);
      if (!guest) return { status: "NONE" as const, ...(buyer ? { cart: buyer } : {}) };
      if (guest.identityId === command.identityId || guest.cartId === buyer?.cartId) {
        return { status: "ATTACHED" as const, cart: guest };
      }
      if (buyer) return { status: "CONFLICT" as const, guest, buyer };
      await this.#claimIdempotency(
        sql,
        "ATTACH_CART",
        command.identityId,
        command.idempotencyKey,
        command.requestHash,
      );
      await sql`
        update order_carts set identity_id = ${command.identityId}, revision = revision + 1,
          updated_at = now() where id = ${guest.cartId}
      `;
      await revokeGuestToken(sql, guest.cartId);
      const attached = await this.#readById(sql, guest.cartId);
      if (!attached) throw new Error("Attached cart was not found");
      await writeCartAudit(
        sql,
        command,
        attached.cartId,
        attached.revision,
        "ATTACH_IDENTITY",
      );
      await this.#completeIdempotency(
        sql,
        "ATTACH_CART",
        command.identityId,
        command.idempotencyKey,
        attached,
      );
      return { status: "ATTACHED" as const, cart: attached };
    });
  }

  async resolveAttachment(command: {
    identityId: IdentityId;
    guestTokenHash: string;
    input: AttachCartInput;
    idempotencyKey: string;
    requestHash: string;
    correlationId: string;
  }) {
    return this.#sql.begin(async (sql) => {
      await advisoryLock(sql, `cart-attach:${command.identityId}`);
      const replay = await this.#claimIdempotency(
        sql,
        "RESOLVE_CART",
        command.identityId,
        command.idempotencyKey,
        command.requestHash,
      );
      if (replay) return parseStoredCart(replay);
      const guest = await this.#readGuest(sql, command.guestTokenHash, true);
      const buyer = await this.#readBuyer(sql, command.identityId, true);
      if (!guest || !buyer) throw new CartResolutionRequiredError();
      if (
        guest.revision !== command.input.guestRevision ||
        buyer.revision !== command.input.buyerRevision
      ) {
        throw new CartRevisionConflictError();
      }

      let kept: StoredCart;
      if (command.input.decision === "MERGE") {
        if (guest.storeId !== buyer.storeId) throw new CartResolutionRequiredError();
        for (const item of guest.items) {
          const current = buyer.items.find(
            (candidate) => candidate.variantId === item.variantId,
          );
          const quantity = (current?.quantity ?? 0) + item.quantity;
          if (quantity > 99) throw new CartQuantityLimitError();
          await sql`
            insert into order_cart_items
              (cart_id, variant_id, product_id, quantity,
               reviewed_publication_version, reviewed_unit_price_amount, updated_at)
            values
              (${buyer.cartId}, ${item.variantId}, ${item.productId}, ${quantity},
               ${item.reviewedPublicationVersion}, ${item.reviewedUnitPriceAmount}, now())
            on conflict (cart_id, variant_id) do update set
              quantity = excluded.quantity, product_id = excluded.product_id,
              updated_at = excluded.updated_at
          `;
        }
        await terminalize(sql, guest.cartId, "MERGED");
        await incrementRevision(sql, buyer.cartId);
        kept = (await this.#readById(sql, buyer.cartId))!;
      } else if (command.input.decision === "KEEP_GUEST") {
        await terminalize(sql, buyer.cartId, "REPLACED");
        await sql`
          update order_carts set identity_id = ${command.identityId},
            revision = revision + 1, updated_at = now()
          where id = ${guest.cartId}
        `;
        await revokeGuestToken(sql, guest.cartId);
        kept = (await this.#readById(sql, guest.cartId))!;
      } else {
        await terminalize(sql, guest.cartId, "REPLACED");
        await incrementRevision(sql, buyer.cartId);
        kept = (await this.#readById(sql, buyer.cartId))!;
      }
      await this.#completeIdempotency(
        sql,
        "RESOLVE_CART",
        command.identityId,
        command.idempotencyKey,
        kept,
      );
      await writeCartAudit(
        sql,
        command,
        kept.cartId,
        kept.revision,
        "RESOLVE_ATTACHMENT",
      );
      return kept;
    });
  }

  async #readGuest(sql: Sql, tokenHash: string, lock = false) {
    const ids = await sql<Array<{ cartId: string }>>`
      select c.id as "cartId" from order_cart_access_tokens token
      join order_carts c on c.id = token.cart_id
      where token.token_hash = ${tokenHash} and token.revoked_at is null
        and token.expires_at > now() and c.status = 'ACTIVE'
        and c.expires_at > now()
      ${lock ? sql`for update of c` : sql``}
    `;
    return ids[0]
      ? this.#readById(sql, cartIdContract.parse(ids[0].cartId))
      : undefined;
  }

  async #readBuyer(sql: Sql, identityId: IdentityId, lock = false) {
    const ids = await sql<Array<{ cartId: string }>>`
      select id as "cartId" from order_carts
      where identity_id = ${identityId} and status = 'ACTIVE' and expires_at > now()
      limit 1 ${lock ? sql`for update` : sql``}
    `;
    return ids[0]
      ? this.#readById(sql, cartIdContract.parse(ids[0].cartId))
      : undefined;
  }

  async #readById(sql: Sql, cartId: CartId): Promise<StoredCart | undefined> {
    const rows = await sql<CartRow[]>`
      select c.id as "cartId", c.store_id as "storeId",
        c.identity_id as "identityId", c.revision,
        c.reviewed_policy_revision as "reviewedPolicyRevision",
        c.reviewed_shipping_hash as "reviewedShippingHash",
        item.variant_id as "variantId", item.product_id as "productId", item.quantity,
        item.reviewed_publication_version as "reviewedPublicationVersion",
        item.reviewed_unit_price_amount as "reviewedUnitPriceAmount"
      from order_carts c
      left join order_cart_items item on item.cart_id = c.id
      where c.id = ${cartId}
      order by item.created_at, item.variant_id
    `;
    if (!rows[0]) return undefined;
    return fromRows(rows);
  }

  async #claimIdempotency(
    sql: Sql,
    operation: string,
    scope: string,
    key: string,
    requestHash: string,
  ): Promise<JSONValue | undefined> {
    const claimed = await sql<Array<{ operation: string }>>`
      insert into order_cart_idempotency_records
        (operation, scope, key, request_hash, response_json)
      values (${operation}, ${scope}, ${key}, ${requestHash}, ${sql.json({})})
      on conflict (operation, scope, key) do nothing returning operation
    `;
    if (claimed[0]) return undefined;
    const rows = await sql<Array<{ requestHash: string; responseJson: JSONValue }>>`
      select request_hash as "requestHash", response_json as "responseJson"
      from order_cart_idempotency_records
      where operation = ${operation} and scope = ${scope} and key = ${key}
      for update
    `;
    const row = rows[0];
    if (!row || row.requestHash !== requestHash) {
      throw new CartIdempotencyConflictError();
    }
    return row.responseJson;
  }

  async #readIdempotency(
    sql: Sql,
    operation: string,
    scope: string,
    key: string,
    requestHash: string,
  ): Promise<JSONValue | undefined> {
    const rows = await sql<Array<{ requestHash: string; responseJson: JSONValue }>>`
      select request_hash as "requestHash", response_json as "responseJson"
      from order_cart_idempotency_records
      where operation = ${operation} and scope = ${scope} and key = ${key}
    `;
    const row = rows[0];
    if (!row) return undefined;
    if (row.requestHash !== requestHash) throw new CartIdempotencyConflictError();
    return row.responseJson;
  }

  async #completeIdempotency(
    sql: Sql,
    operation: string,
    scope: string,
    key: string,
    response: StoredCart,
  ) {
    await sql`
      update order_cart_idempotency_records
      set response_json = ${sql.json(JSON.parse(JSON.stringify(response)) as JSONValue)}
      where operation = ${operation} and scope = ${scope} and key = ${key}
    `;
  }

  async onModuleDestroy() {
    await this.#sql.end();
  }
}

function fromRows(rows: CartRow[]): StoredCart {
  const first = rows[0]!;
  return {
    cartId: cartIdContract.parse(first.cartId),
    storeId: storeIdContract.parse(first.storeId),
    ...(first.identityId
      ? { identityId: identityIdContract.parse(first.identityId) }
      : {}),
    revision: first.revision,
    reviewedPolicyRevision: first.reviewedPolicyRevision,
    reviewedShippingHash: first.reviewedShippingHash.trim(),
    items: rows.flatMap((row) =>
      row.variantId && row.productId && row.quantity
        ? [
            {
              variantId: variantIdContract.parse(row.variantId),
              productId: productIdContract.parse(row.productId),
              quantity: row.quantity,
              reviewedPublicationVersion: row.reviewedPublicationVersion ?? 0,
              reviewedUnitPriceAmount: row.reviewedUnitPriceAmount ?? 0,
            },
          ]
        : [],
    ),
  };
}

function parseStoredCart(value: JSONValue): StoredCart {
  const object = value as Record<string, unknown>;
  return {
    cartId: cartIdContract.parse(object.cartId),
    storeId: storeIdContract.parse(object.storeId),
    ...(object.identityId
      ? { identityId: identityIdContract.parse(object.identityId) }
      : {}),
    revision: Number(object.revision),
    reviewedPolicyRevision: Number(object.reviewedPolicyRevision ?? 0),
    reviewedShippingHash: String(object.reviewedShippingHash ?? ""),
    items: (object.items as Array<Record<string, unknown>>).map((item) => ({
      productId: productIdContract.parse(item.productId),
      variantId: variantIdContract.parse(item.variantId),
      quantity: Number(item.quantity),
      reviewedPublicationVersion: Number(item.reviewedPublicationVersion ?? 0),
      reviewedUnitPriceAmount: Number(item.reviewedUnitPriceAmount ?? 0),
    })),
  };
}

async function advisoryLock(sql: Sql, key: string) {
  await sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
}

async function revokeGuestToken(sql: Sql, cartId: CartId) {
  await sql`
    update order_cart_access_tokens set revoked_at = now()
    where cart_id = ${cartId} and revoked_at is null
  `;
}

async function terminalize(sql: Sql, cartId: CartId, status: "MERGED" | "REPLACED") {
  await sql`
    update order_carts set status = ${status}, identity_id = null, updated_at = now()
    where id = ${cartId}
  `;
  await revokeGuestToken(sql, cartId);
}

async function incrementRevision(sql: Sql, cartId: CartId) {
  await sql`
    update order_carts set revision = revision + 1, updated_at = now()
    where id = ${cartId}
  `;
}

async function writeCartAudit(
  sql: Sql,
  command: { identityId?: IdentityId; correlationId: string },
  cartId: CartId,
  revision: number,
  operation: string,
) {
  await sql`
    insert into order_cart_audits
      (id, cart_id, operation, actor_kind, actor_identity_id, revision, correlation_id)
    values
      (${randomUUID()}, ${cartId}, ${operation},
       ${command.identityId ? "IDENTITY" : "GUEST"},
       ${command.identityId ?? null}, ${revision}, ${command.correlationId})
  `;
}
