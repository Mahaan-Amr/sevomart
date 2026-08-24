import { randomUUID } from "node:crypto";

import {
  productPublishedV1Contract,
  publicSimpleProductContract,
  simpleProductDraftContract,
  simpleProductEmptyDraftContract,
  simpleProductIncompleteDraftContract,
  type ReplaceSimpleProductWorkingCopy,
  type SimpleProductView,
} from "@sevo/contracts/product/v1";
import { storeIdContract, variantIdContract } from "@sevo/contracts/platform/v1";
import { enqueueOutboxEvent } from "@sevo/outbox";
import postgres, { type JSONValue, type Sql } from "postgres";

import type { InventoryAuthoring } from "../../inventory/public";
import {
  ProductIdempotencyConflictError,
  ProductNotFoundError,
  ProductRevisionConflictError,
  type ProductRepository,
  type ProductWriteContext,
} from "../public";

type ProductRow = {
  productId: string;
  storeId: string;
  state: "DRAFT" | "PUBLISHED";
  revision: number;
  publicationVersion: number;
  name: string | null;
  description: string | null;
  mediaId: string | null;
  variantId: string | null;
  amount: number | string | null;
};

type PublicationRow = {
  productId: string;
  name: string;
  description: string;
  mediaId: string;
  variantId: string;
  amount: number | string;
  publicationVersion: number;
};

export class PostgresProductRepository implements ProductRepository {
  readonly #sql: Sql;

  constructor(
    databaseUrl: string,
    private readonly inventory: InventoryAuthoring,
    private readonly createId: () => string = randomUUID,
  ) {
    this.#sql = postgres(databaseUrl, { max: 5 });
  }

  async create(productId: string, storeId: string, context: ProductWriteContext) {
    return this.#sql.begin((sql) =>
      this.#idempotentWrite(sql, context, async () => {
        await sql`
          insert into product_products (id, store_id, state, revision)
          values (${productId}, ${storeId}, 'DRAFT', 0)
        `;
        return simpleProductEmptyDraftContract.parse({
          productId,
          state: "DRAFT",
          revision: 0,
          publicationVersion: 0,
          workingCopy: null,
          inventory: null,
        });
      }),
    );
  }

  async replaceWorkingCopy(
    productId: string,
    storeId: string,
    proposedVariantId: string,
    input: ReplaceSimpleProductWorkingCopy,
    context: ProductWriteContext,
  ) {
    return this.#sql.begin((sql) =>
      this.#idempotentWrite(sql, context, async () => {
        const current = await this.#lockOwned(sql, productId, storeId);
        if (current.revision !== context.expectedRevision) {
          throw new ProductRevisionConflictError(
            context.expectedRevision,
            current.revision,
          );
        }
        const variantId = current.variantId ?? proposedVariantId;
        const inventory = input.inventory
          ? await this.inventory.replaceForProduct(sql, {
              storeId: storeIdContract.parse(storeId),
              variantId: variantIdContract.parse(variantId),
              onHand: input.inventory.onHand,
              expectedRevision: input.inventory.expectedRevision,
            })
          : await this.inventory.readInTransaction(
              sql,
              variantIdContract.parse(variantId),
            );
        await sql`
          insert into product_working_copies
            (product_id, name, description, media_id, variant_id)
          values
            (${productId}, ${input.workingCopy.name}, ${input.workingCopy.description},
             ${input.workingCopy.orderedMediaIds[0] ?? null}, ${variantId})
          on conflict (product_id) do update set
            name = excluded.name, description = excluded.description,
            media_id = excluded.media_id, variant_id = excluded.variant_id
        `;
        if (input.workingCopy.variant.price) {
          await sql`
            insert into product_offers (product_id, variant_id, amount, currency, revision)
            values (${productId}, ${variantId},
              ${input.workingCopy.variant.price.amount}, 'IRR', 1)
            on conflict (product_id) do update set
              amount = excluded.amount, revision = product_offers.revision + 1
          `;
        }
        const revision = current.revision + 1;
        await sql`
          update product_products set revision = ${revision}, updated_at = now()
          where id = ${productId}
        `;
        const view = {
          productId,
          state: current.state,
          revision,
          publicationVersion: current.publicationVersion,
          workingCopy: {
            name: input.workingCopy.name,
            description: input.workingCopy.description,
            orderedMediaIds: input.workingCopy.orderedMediaIds,
            variant: { variantId, price: input.workingCopy.variant.price },
          },
          inventory: inventory ?? null,
        };
        return input.workingCopy.name &&
          input.workingCopy.orderedMediaIds.length === 1 &&
          input.workingCopy.variant.price &&
          inventory
          ? simpleProductDraftContract.parse(view)
          : simpleProductIncompleteDraftContract.parse(view);
      }),
    );
  }

  async readOwned(productId: string, storeId: string) {
    const row = await this.#readRow(this.#sql, productId, storeId);
    return row ? this.#toView(row) : undefined;
  }

  async publish(productId: string, storeId: string, context: ProductWriteContext) {
    return this.#sql.begin((sql) =>
      this.#idempotentWrite(sql, context, async () => {
        const current = await this.#lockOwned(sql, productId, storeId);
        if (current.revision !== context.expectedRevision) {
          throw new ProductRevisionConflictError(
            context.expectedRevision,
            current.revision,
          );
        }
        if (
          !current.name ||
          !current.mediaId ||
          !current.variantId ||
          current.amount === null
        ) {
          throw new Error("Product publication is not ready");
        }
        const inventory = await this.inventory.readInTransaction(
          sql,
          variantIdContract.parse(current.variantId),
        );
        if (!inventory) throw new Error("Product inventory is not provisioned");
        const publicationVersion = current.publicationVersion + 1;
        const revision = current.revision + 1;
        await sql`
          insert into product_publications
            (product_id, publication_version, name, description, media_id, variant_id)
          values
            (${productId}, ${publicationVersion}, ${current.name},
             ${current.description ?? ""}, ${current.mediaId}, ${current.variantId})
        `;
        await sql`
          update product_products set state = 'PUBLISHED', revision = ${revision},
            publication_version = ${publicationVersion}, published_at = now(),
            updated_at = now()
          where id = ${productId}
        `;
        const publicProduct = toPublicProduct(
          {
            productId,
            name: current.name,
            description: current.description ?? "",
            mediaId: current.mediaId,
            variantId: current.variantId,
            amount: current.amount,
            publicationVersion,
          },
          inventory.onHand,
        );
        await enqueueOutboxEvent(
          sql,
          productPublishedV1Contract.parse({
            version: 1,
            eventId: this.createId(),
            eventType: "ProductPublished.v1",
            aggregateId: productId,
            aggregateVersion: revision,
            occurredAt: new Date().toISOString(),
            correlationId: context.correlationId,
            actor: { type: "IDENTITY", id: context.actorId },
            payload: {
              storeId,
              productId,
              publicationVersion,
              price: publicProduct.price,
              availability: publicProduct.availability,
            },
          }),
        );
        return publicProduct;
      }),
    );
  }

  async readPublished(productId: string, storeId: string) {
    const rows = await this.#sql<PublicationRow[]>`
      select p.id as "productId", publication.name, publication.description,
        publication.media_id as "mediaId", publication.variant_id as "variantId",
        offer.amount, p.publication_version as "publicationVersion"
      from product_products p
      join product_publications publication
        on publication.product_id = p.id
       and publication.publication_version = p.publication_version
      join product_offers offer on offer.product_id = p.id
      where p.id = ${productId}::uuid and p.store_id = ${storeId}::uuid
        and p.state = 'PUBLISHED'
      limit 1
    `;
    return rows[0] ? this.#toPublic(rows[0]) : undefined;
  }

  async listPublished(storeId: string) {
    const rows = await this.#sql<PublicationRow[]>`
      select p.id as "productId", publication.name, publication.description,
        publication.media_id as "mediaId", publication.variant_id as "variantId",
        offer.amount, p.publication_version as "publicationVersion"
      from product_products p
      join product_publications publication
        on publication.product_id = p.id
       and publication.publication_version = p.publication_version
      join product_offers offer on offer.product_id = p.id
      where p.store_id = ${storeId}::uuid and p.state = 'PUBLISHED'
      order by p.published_at desc, p.id
    `;
    return Promise.all(rows.map((row) => this.#toPublic(row)));
  }

  async findPublishedMediaStoreId(mediaId: string) {
    const rows = await this.#sql<Array<{ storeId: string }>>`
      select p.store_id as "storeId"
      from product_products p
      join product_publications publication
        on publication.product_id = p.id
       and publication.publication_version = p.publication_version
      where publication.media_id = ${mediaId}::uuid and p.state = 'PUBLISHED'
      limit 1
    `;
    return rows[0] ? storeIdContract.parse(rows[0].storeId) : undefined;
  }

  async #toPublic(row: PublicationRow) {
    const inventory = await this.inventory.read(variantIdContract.parse(row.variantId));
    if (!inventory) {
      throw new Error("Published product inventory is missing");
    }
    return toPublicProduct(row, inventory.onHand);
  }

  async #toView(row: ProductRow): Promise<SimpleProductView> {
    if (!row.variantId) {
      return simpleProductEmptyDraftContract.parse({
        productId: row.productId,
        state: "DRAFT",
        revision: row.revision,
        publicationVersion: row.publicationVersion,
        workingCopy: null,
        inventory: null,
      });
    }
    const inventory =
      (await this.inventory.read(variantIdContract.parse(row.variantId))) ?? null;
    const view = {
      productId: row.productId,
      state: row.state,
      revision: row.revision,
      publicationVersion: row.publicationVersion,
      workingCopy: {
        name: row.name,
        description: row.description ?? "",
        orderedMediaIds: row.mediaId ? [row.mediaId] : [],
        variant: {
          variantId: row.variantId,
          price:
            row.amount === null
              ? null
              : { amount: Number(row.amount), currency: "IRR" as const },
        },
      },
      inventory,
    };
    return row.name && row.mediaId && row.amount !== null && inventory
      ? simpleProductDraftContract.parse(view)
      : simpleProductIncompleteDraftContract.parse(view);
  }

  async #lockOwned(sql: Sql, productId: string, storeId: string) {
    const row = await this.#readRow(sql, productId, storeId, true);
    if (!row) throw new ProductNotFoundError();
    return row;
  }

  async #readRow(sql: Sql, productId: string, storeId: string, lock = false) {
    const rows = await sql<ProductRow[]>`
      select p.id as "productId", p.store_id as "storeId", p.state, p.revision,
        p.publication_version as "publicationVersion", working.name,
        working.description, working.media_id as "mediaId",
        working.variant_id as "variantId", offer.amount
      from product_products p
      left join product_working_copies working on working.product_id = p.id
      left join product_offers offer on offer.product_id = p.id
      where p.id = ${productId}::uuid and p.store_id = ${storeId}::uuid
      ${lock ? sql`for update of p` : sql``}
    `;
    return rows[0];
  }

  async #idempotentWrite<T>(
    sql: Sql,
    context: ProductWriteContext,
    write: () => Promise<T>,
  ): Promise<T> {
    const claimed = await sql<Array<{ operation: string }>>`
      insert into product_idempotency_records
        (operation, actor_identity_id, idempotency_key, request_hash, response_json)
      values
        (${context.operation}, ${context.actorId}, ${context.idempotencyKey},
         ${context.requestHash}, ${sql.json({})})
      on conflict (operation, actor_identity_id, idempotency_key) do nothing
      returning operation
    `;
    if (!claimed[0]) {
      const records = await sql<
        Array<{ requestHash: string; responseJson: JSONValue }>
      >`
        select request_hash as "requestHash", response_json as "responseJson"
        from product_idempotency_records
        where operation = ${context.operation}
          and actor_identity_id = ${context.actorId}
          and idempotency_key = ${context.idempotencyKey}
        for update
      `;
      const record = records[0];
      if (!record || record.requestHash !== context.requestHash) {
        throw new ProductIdempotencyConflictError();
      }
      return record.responseJson as unknown as T;
    }
    const result = await write();
    await sql`
      update product_idempotency_records
      set response_json = ${sql.json(JSON.parse(JSON.stringify(result)) as JSONValue)}
      where operation = ${context.operation}
        and actor_identity_id = ${context.actorId}
        and idempotency_key = ${context.idempotencyKey}
    `;
    return result;
  }

  async onModuleDestroy() {
    await this.#sql.end();
  }
}

function toPublicProduct(row: PublicationRow, onHand: number) {
  return publicSimpleProductContract.parse({
    productId: row.productId,
    name: row.name,
    description: row.description,
    image: { id: row.mediaId, url: `/v1/media/${row.mediaId}` },
    price: { amount: Number(row.amount), currency: "IRR" },
    availability: onHand > 0 ? "AVAILABLE" : "OUT_OF_STOCK",
    publicationVersion: row.publicationVersion,
  });
}
