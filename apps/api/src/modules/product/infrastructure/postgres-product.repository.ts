import { randomUUID } from "node:crypto";

import {
  productBatchResultContract,
  productViewContract,
  productPublishedV2Contract,
  productCombinationKey,
  publicProductContract,
  publicProductSummaryContract,
  variantAvailabilityChangedV1Contract,
  variantPriceChangedV1Contract,
  publicSimpleProductContract,
  publicSimpleProductSummaryContract,
  simpleProductDraftContract,
  simpleProductEmptyDraftContract,
  simpleProductIncompleteDraftContract,
  type ReplaceSimpleProductWorkingCopy,
  type ReplaceProductInventoryBatch,
  type ReplaceProductOffersBatch,
  type ReplaceProductWorkingCopy,
  type ProductView,
  type PublicProduct,
  type SimpleProductView,
} from "@sevo/contracts/product/v1";
import {
  productIdContract,
  storeIdContract,
  variantIdContract,
  type VariantId,
} from "@sevo/contracts/platform/v1";
import { enqueueOutboxEvent } from "@sevo/outbox";
import postgres, { type JSONValue, type Sql } from "postgres";

import type {
  InventoryAuthoring,
  InventoryTransactionContext,
} from "../../inventory/public";
import {
  ProductIdempotencyConflictError,
  DuplicateSkuError,
  InvalidVariantError,
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
  offerVersion: number | null;
};

type PublicationRow = {
  productId: string;
  name: string;
  description: string;
  mediaId: string;
  variantId: string;
  amount: number | string;
  offerVersion: number;
  publicationVersion: number;
};

type ProductBaseRow = {
  productId: string;
  storeId: string;
  state: "DRAFT" | "PUBLISHED" | "UNPUBLISHED";
  revision: number;
  publicationVersion: number;
  definition: JSONValue | null;
};

type VariantRow = {
  variantId: string;
  clientKey: string;
  combinationKey: string;
  amount: number | string | null;
  sku: string | null;
  offerRevision: number | null;
};

type StoredDefinition = {
  name: string | null;
  description: string;
  orderedMediaIds: string[];
  axes: ReplaceProductWorkingCopy["workingCopy"]["axes"];
  variants: Array<{
    clientKey: string;
    variantId: string;
    combination: ReplaceProductWorkingCopy["workingCopy"]["variants"][number]["combination"];
  }>;
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
        const inventoryTransaction = sql as unknown as InventoryTransactionContext;
        const inventory = input.inventory
          ? await this.inventory.replaceForProduct(inventoryTransaction, {
              storeId: storeIdContract.parse(storeId),
              variantId: variantIdContract.parse(variantId),
              onHand: input.inventory.onHand,
              expectedRevision: input.inventory.expectedRevision,
              reasonCode: "INITIAL_STOCK",
              actorId: context.actorId,
              correlationId: context.correlationId,
            })
          : await this.inventory.readInTransaction(
              inventoryTransaction,
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
            on conflict (variant_id) do update set
              amount = excluded.amount, revision = product_offers.revision + 1
          `;
        } else if (current.state === "DRAFT") {
          await sql`
            delete from product_offers
            where product_id = ${productId} and variant_id = ${variantId}
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
          current.amount === null ||
          current.offerVersion === null
        ) {
          throw new Error("Product publication is not ready");
        }
        const inventory = await this.inventory.readInTransaction(
          sql as unknown as InventoryTransactionContext,
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
            offerVersion: current.offerVersion,
            publicationVersion,
          },
          inventory.onHand,
        );
        await enqueueOutboxEvent(
          sql,
          productPublishedV2Contract.parse({
            version: 1,
            eventId: this.createId(),
            eventType: "ProductPublished.v2",
            aggregateId: productId,
            aggregateVersion: revision,
            occurredAt: new Date().toISOString(),
            correlationId: context.correlationId,
            actor: { type: "IDENTITY", id: context.actorId },
            payload: {
              storeId,
              productId,
              publicationVersion,
              snapshot: { variantIds: [current.variantId] },
              offerVersion: current.offerVersion,
              availabilityVersion: inventory.revision,
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
        offer.amount, offer.revision as "offerVersion",
        p.publication_version as "publicationVersion"
      from product_products p
      join product_publications publication
        on publication.product_id = p.id
       and publication.publication_version = p.publication_version
      join product_offers offer on offer.product_id = p.id
      where p.id = ${productId}::uuid and p.store_id = ${storeId}::uuid
        and p.state = 'PUBLISHED' and publication.snapshot is null
      limit 1
    `;
    return rows[0] ? this.#toPublic(rows[0]) : undefined;
  }

  async listPublished(storeId: string) {
    const rows = await this.#sql<PublicationRow[]>`
      select p.id as "productId", publication.name, publication.description,
        publication.media_id as "mediaId", publication.variant_id as "variantId",
        offer.amount, offer.revision as "offerVersion",
        p.publication_version as "publicationVersion"
      from product_products p
      join product_publications publication
        on publication.product_id = p.id
       and publication.publication_version = p.publication_version
      join product_offers offer on offer.product_id = p.id
      where p.store_id = ${storeId}::uuid and p.state = 'PUBLISHED'
        and publication.snapshot is null
      order by p.published_at desc, p.id
    `;
    return Promise.all(
      rows.map(async (row) => toPublicSummary(await this.#toPublic(row))),
    );
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

  async replaceProductWorkingCopy(
    productId: string,
    storeId: string,
    input: ReplaceProductWorkingCopy,
    context: ProductWriteContext,
  ) {
    return this.#sql.begin((sql) =>
      this.#idempotentWrite(sql, context, async () => {
        const current = await this.#lockProductBase(sql, productId, storeId);
        this.#requireRevision(current, context.expectedRevision);
        const normalized = normalizeWorkingCopy(input.workingCopy);
        const currentVariants = await this.#readVariantRows(sql, productId, true, true);
        const byClientKey = new Map(currentVariants.map((row) => [row.clientKey, row]));
        const byCombination = new Map(
          currentVariants.map((row) => [row.combinationKey, row]),
        );
        const storedVariants: StoredDefinition["variants"] = [];
        const submittedIds = new Set<string>();
        const newIds = new Set<string>();
        for (const variant of normalized.variants) {
          const combination = normalized.axes.map((axis) => {
            const selection = variant.combination.find(
              (entry) => entry.axisClientKey === axis.clientKey,
            )!;
            return selection;
          });
          const combinationKey = productCombinationKey(combination);
          const existingByClient = byClientKey.get(variant.clientKey);
          const existingByCombination = byCombination.get(combinationKey);
          if (
            (existingByClient && existingByClient.combinationKey !== combinationKey) ||
            (existingByCombination &&
              existingByCombination.clientKey !== variant.clientKey)
          ) {
            throw new InvalidVariantError(
              "Variant client keys and combinations are stable",
            );
          }
          const variantId = existingByClient?.variantId ?? this.createId();
          if (!existingByClient) newIds.add(variantId);
          submittedIds.add(variantId);
          await sql`
            insert into product_variants
              (id, product_id, store_id, client_key, combination_key, retired)
            values
              (${variantId}, ${productId}, ${storeId}, ${variant.clientKey},
               ${combinationKey}, false)
            on conflict (id) do update set retired = false
          `;
          storedVariants.push({
            clientKey: variant.clientKey,
            variantId,
            combination,
          });
          const existingOffer = existingByClient;
          if (!existingOffer || current.state === "DRAFT") {
            if (variant.price) {
              await this.#claimSku(sql, storeId, variantId, variant.sku);
              const unchanged =
                existingOffer?.amount !== null &&
                Number(existingOffer?.amount) === variant.price.amount &&
                existingOffer?.sku === variant.sku;
              if (!unchanged) {
                await sql`
                  insert into product_offers
                    (product_id, variant_id, amount, currency, sku, revision)
                  values
                    (${productId}, ${variantId}, ${variant.price.amount}, 'IRR',
                     ${variant.sku}, 1)
                  on conflict (variant_id) do update set
                    amount = excluded.amount, sku = excluded.sku,
                    revision = product_offers.revision + 1
                `;
              }
            } else if (current.state === "DRAFT") {
              await sql`delete from product_offers where variant_id = ${variantId}`;
            }
          }
        }
        if (submittedIds.size > 0) {
          await sql`
            update product_variants set retired = true
            where product_id = ${productId}
              and id not in ${sql([...submittedIds])}
          `;
        } else {
          await sql`update product_variants set retired = true where product_id = ${productId}`;
        }
        const requestedInventory = new Map(
          (input.inventory?.rows ?? []).map((row) => [row.variantClientKey, row]),
        );
        const inventoryRows: Array<{
          variantId: ReturnType<typeof variantIdContract.parse>;
          onHand: number;
          expectedRevision: number;
        }> = [];
        for (const variant of storedVariants) {
          const requested = requestedInventory.get(variant.clientKey);
          const existing = await this.inventory.readInTransaction(
            sql as unknown as InventoryTransactionContext,
            variantIdContract.parse(variant.variantId),
          );
          if (requested) {
            inventoryRows.push({
              variantId: variantIdContract.parse(variant.variantId),
              onHand: requested.onHand,
              expectedRevision: requested.expectedRevision,
            });
          } else if (!existing || newIds.has(variant.variantId)) {
            inventoryRows.push({
              variantId: variantIdContract.parse(variant.variantId),
              onHand: 0,
              expectedRevision: 0,
            });
          }
        }
        if (inventoryRows.length > 0) {
          await this.inventory.replaceBatchForProduct(
            sql as unknown as InventoryTransactionContext,
            {
              storeId: storeIdContract.parse(storeId),
              rows: inventoryRows,
              reasonCode: "INITIAL_STOCK",
              actorId: context.actorId,
              correlationId: context.correlationId,
            },
          );
        }
        const definition: StoredDefinition = {
          name: normalized.name,
          description: normalized.description,
          orderedMediaIds: normalized.orderedMediaIds,
          axes: normalized.axes,
          variants: storedVariants,
        };
        await sql`
          insert into product_working_copies
            (product_id, name, description, media_id, variant_id, definition)
          values
            (${productId}, ${definition.name}, ${definition.description},
             ${definition.orderedMediaIds[0] ?? null},
             ${definition.variants[0]?.variantId ?? null},
             ${sql.json(definition as unknown as JSONValue)})
          on conflict (product_id) do update set
            name = excluded.name, description = excluded.description,
            media_id = excluded.media_id, variant_id = excluded.variant_id,
            definition = excluded.definition
        `;
        await sql`
          update product_products set revision = revision + 1, updated_at = now()
          where id = ${productId}
        `;
        const result = await this.#readProductViewInTransaction(
          sql,
          productId,
          storeId,
        );
        if (!result) throw new ProductNotFoundError();
        return result;
      }),
    );
  }

  async readProductOwned(productId: string, storeId: string) {
    return this.#readProductViewInTransaction(this.#sql, productId, storeId);
  }

  async previewProduct(productId: string, storeId: string) {
    const view = await this.#readProductViewInTransaction(
      this.#sql,
      productId,
      storeId,
    );
    if (!view) throw new ProductNotFoundError();
    return toPublicMultivariant(view, view.publicationVersion + 1);
  }

  async replaceOffersBatch(
    productId: string,
    storeId: string,
    input: ReplaceProductOffersBatch,
    context: ProductWriteContext,
  ) {
    return this.#sql.begin((sql) =>
      this.#idempotentWrite(sql, context, async () => {
        const current = await this.#lockProductBase(sql, productId, storeId);
        this.#requireRevision(current, context.expectedRevision);
        const variants = await this.#readVariantRows(sql, productId, true);
        const byId = new Map(variants.map((row) => [row.variantId, row]));
        for (const row of input.rows) {
          const variant = byId.get(row.variantId);
          if (!variant || variant.offerRevision === null)
            throw new InvalidVariantError();
          if (variant.offerRevision !== row.expectedRevision) {
            throw new ProductRevisionConflictError(
              row.expectedRevision,
              variant.offerRevision,
            );
          }
        }
        const normalizedSkus = input.rows
          .map((row) => row.sku?.toLocaleLowerCase("fa"))
          .filter((sku): sku is string => Boolean(sku));
        if (new Set(normalizedSkus).size !== normalizedSkus.length) {
          throw new DuplicateSkuError();
        }
        const results: Array<{ variantId: string; revision: number }> = [];
        for (const row of input.rows) {
          await this.#claimSku(sql, storeId, row.variantId, row.sku);
          const updated = await sql<Array<{ revision: number }>>`
            update product_offers set amount = ${row.price.amount}, sku = ${row.sku},
              revision = revision + 1
            where product_id = ${productId} and variant_id = ${row.variantId}
            returning revision
          `;
          results.push({ variantId: row.variantId, revision: updated[0]!.revision });
          if (current.state === "PUBLISHED") {
            await enqueueOutboxEvent(
              sql,
              variantPriceChangedV1Contract.parse({
                version: 1,
                eventId: this.createId(),
                eventType: "VariantPriceChanged.v1",
                aggregateId: row.variantId,
                aggregateVersion: updated[0]!.revision,
                occurredAt: new Date().toISOString(),
                correlationId: context.correlationId,
                actor: { type: "IDENTITY", id: context.actorId },
                payload: {
                  storeId,
                  productId,
                  variantId: row.variantId,
                  publicationVersion: current.publicationVersion,
                  offerVersion: updated[0]!.revision,
                  price: row.price,
                },
              }),
            );
          }
        }
        const revision = current.revision + 1;
        await sql`update product_products set revision = ${revision}, updated_at = now() where id = ${productId}`;
        return productBatchResultContract.parse({
          productRevision: revision,
          rows: results,
        });
      }),
    );
  }

  async replaceInventoryBatch(
    productId: string,
    storeId: string,
    input: ReplaceProductInventoryBatch,
    context: ProductWriteContext,
  ) {
    return this.#sql.begin((sql) =>
      this.#idempotentWrite(sql, context, async () => {
        const current = await this.#lockProductBase(sql, productId, storeId);
        this.#requireRevision(current, context.expectedRevision);
        const variants = await this.#readVariantRows(sql, productId, true);
        const activeIds = new Set(variants.map((row) => row.variantId));
        if (input.rows.some((row) => !activeIds.has(row.variantId))) {
          throw new InvalidVariantError();
        }
        const before = new Map(
          await Promise.all(
            input.rows.map(
              async (row) =>
                [
                  row.variantId,
                  await this.inventory.readInTransaction(
                    sql as unknown as InventoryTransactionContext,
                    row.variantId,
                  ),
                ] as const,
            ),
          ),
        );
        const rows = await this.inventory.replaceBatchForProduct(
          sql as unknown as InventoryTransactionContext,
          {
            storeId: storeIdContract.parse(storeId),
            rows: input.rows,
            reasonCode: input.reasonCode,
            actorId: context.actorId,
            correlationId: context.correlationId,
          },
        );
        const revision = current.revision + 1;
        if (current.state === "PUBLISHED") {
          for (const row of rows) {
            const wasAvailable = (before.get(row.variantId)?.onHand ?? 0) > 0;
            const isAvailable = row.onHand > 0;
            if (wasAvailable === isAvailable) continue;
            await enqueueOutboxEvent(
              sql,
              variantAvailabilityChangedV1Contract.parse({
                version: 1,
                eventId: this.createId(),
                eventType: "VariantAvailabilityChanged.v1",
                aggregateId: row.variantId,
                aggregateVersion: row.revision,
                occurredAt: new Date().toISOString(),
                correlationId: context.correlationId,
                actor: { type: "IDENTITY", id: context.actorId },
                payload: {
                  storeId,
                  productId,
                  variantId: row.variantId,
                  publicationVersion: current.publicationVersion,
                  availabilityVersion: row.revision,
                  availability: isAvailable ? "AVAILABLE" : "OUT_OF_STOCK",
                },
              }),
            );
          }
        }
        await sql`update product_products set revision = ${revision}, updated_at = now() where id = ${productId}`;
        return productBatchResultContract.parse({
          productRevision: revision,
          rows: rows.map((row) => ({
            variantId: row.variantId,
            revision: row.revision,
          })),
        });
      }),
    );
  }

  async publishProduct(
    productId: string,
    storeId: string,
    context: ProductWriteContext,
  ) {
    return this.#sql.begin((sql) =>
      this.#idempotentWrite(sql, context, async () => {
        const current = await this.#lockProductBase(sql, productId, storeId);
        this.#requireRevision(current, context.expectedRevision);
        const view = await this.#readProductViewInTransaction(sql, productId, storeId);
        if (!view) throw new ProductNotFoundError();
        const publicationVersion = current.publicationVersion + 1;
        const projection = toPublicMultivariant(view, publicationVersion);
        const firstImage = projection.images[0]!;
        const firstVariant = projection.variants[0]!;
        await sql`
          insert into product_publications
            (product_id, publication_version, name, description, media_id,
             variant_id, snapshot)
          values
            (${productId}, ${publicationVersion}, ${projection.name},
             ${projection.description}, ${firstImage.id}, ${firstVariant.variantId},
             ${sql.json(projection as unknown as JSONValue)})
        `;
        const revision = current.revision + 1;
        await sql`
          update product_products set state = 'PUBLISHED', revision = ${revision},
            publication_version = ${publicationVersion}, published_at = now(),
            updated_at = now() where id = ${productId}
        `;
        await sql`
          update product_variants set ever_published = true
          where product_id = ${productId} and retired = false
        `;
        const maxOfferVersion = Math.max(
          ...view.workingCopy!.variants.map((variant) => variant.offerRevision),
        );
        const maxAvailabilityVersion = Math.max(
          ...view.inventory.map((row) => row.revision),
        );
        await enqueueOutboxEvent(
          sql,
          productPublishedV2Contract.parse({
            version: 1,
            eventId: this.createId(),
            eventType: "ProductPublished.v2",
            aggregateId: productId,
            aggregateVersion: revision,
            occurredAt: new Date().toISOString(),
            correlationId: context.correlationId,
            actor: { type: "IDENTITY", id: context.actorId },
            payload: {
              storeId,
              productId,
              publicationVersion,
              snapshot: {
                variantIds: projection.variants.map((variant) => variant.variantId),
              },
              offerVersion: maxOfferVersion,
              availabilityVersion: maxAvailabilityVersion,
            },
          }),
        );
        return projection;
      }),
    );
  }

  async readPublishedProduct(productId: string, storeId: string) {
    const rows = await this.#sql<Array<{ snapshot: JSONValue }>>`
      select publication.snapshot
      from product_products product
      join product_publications publication
        on publication.product_id = product.id
       and publication.publication_version = product.publication_version
      where product.id = ${productId} and product.store_id = ${storeId}
        and product.state = 'PUBLISHED' and publication.snapshot is not null
    `;
    if (!rows[0]) return undefined;
    return this.#refreshPublicProduct(publicProductContract.parse(rows[0].snapshot));
  }

  async listPublishedProducts(storeId: string) {
    const rows = await this.#sql<Array<{ productId: string }>>`
      select id as "productId" from product_products
      where store_id = ${storeId} and state = 'PUBLISHED'
      order by published_at desc, id
    `;
    const products = await Promise.all(
      rows.map((row) => this.readPublishedProduct(row.productId, storeId)),
    );
    return products
      .filter((product): product is PublicProduct => Boolean(product))
      .map(toPublicMultivariantSummary);
  }

  async readAuthoritativeVariant(variantId: VariantId) {
    const rows = await this.#sql<
      Array<{
        productId: string;
        storeId: string;
        name: string;
        mediaId: string;
        amount: number | string;
        publicationVersion: number;
        snapshot: JSONValue | null;
      }>
    >`
      select product.id as "productId", product.store_id as "storeId",
        publication.name, publication.media_id as "mediaId", offer.amount,
        product.publication_version as "publicationVersion", publication.snapshot
      from product_products product
      join product_publications publication
        on publication.product_id = product.id
       and publication.publication_version = product.publication_version
      join product_offers offer
        on offer.product_id = product.id and offer.variant_id = ${variantId}::uuid
      where product.state = 'PUBLISHED'
        and (
          publication.variant_id = ${variantId}::uuid
          or (
            publication.snapshot is not null
            and publication.snapshot -> 'variants' @>
              jsonb_build_array(jsonb_build_object('variantId', ${variantId}::text))
          )
        )
      limit 1
    `;
    const row = rows[0];
    if (!row) return undefined;
    if (!row.snapshot) {
      return {
        productId: productIdContract.parse(row.productId),
        variantId,
        storeId: storeIdContract.parse(row.storeId),
        name: row.name,
        image: { id: row.mediaId, url: `/v1/media/${row.mediaId}` },
        unitPrice: { amount: Number(row.amount), currency: "IRR" as const },
        publicationVersion: row.publicationVersion,
        sellable: true,
      } as const;
    }
    const product = await this.#refreshPublicProduct(
      publicProductContract.parse(row.snapshot),
    );
    const variant = product.variants.find(
      (candidate) => candidate.variantId === variantId,
    );
    if (!variant) return undefined;
    return {
      productId: productIdContract.parse(row.productId),
      variantId: variantIdContract.parse(variant.variantId),
      storeId: storeIdContract.parse(row.storeId),
      name: product.name,
      image: product.images[0]!,
      unitPrice: variant.price,
      publicationVersion: product.publicationVersion,
      sellable: true,
    } as const;
  }

  async #refreshPublicProduct(product: PublicProduct) {
    const variantIds = product.variants.map((variant) => variant.variantId);
    const offers = await this.#sql<
      Array<{ variantId: string; amount: number | string }>
    >`
      select variant_id as "variantId", amount from product_offers
      where variant_id in ${this.#sql(variantIds)}
    `;
    const inventory = await this.inventory.readMany(variantIds);
    const offerById = new Map(offers.map((row) => [row.variantId, Number(row.amount)]));
    const inventoryById = new Map(inventory.map((row) => [row.variantId, row.onHand]));
    const variants = product.variants.map((variant) => ({
      ...variant,
      price: {
        amount: offerById.get(variant.variantId) ?? variant.price.amount,
        currency: "IRR" as const,
      },
      availability:
        (inventoryById.get(variant.variantId) ?? 0) > 0
          ? ("AVAILABLE" as const)
          : ("OUT_OF_STOCK" as const),
    }));
    return publicProductContract.parse({
      ...product,
      variants,
      priceRange: priceRange(variants.map((variant) => variant.price.amount)),
      availability: variants.some((variant) => variant.availability === "AVAILABLE")
        ? "AVAILABLE"
        : "OUT_OF_STOCK",
    });
  }

  async #readProductViewInTransaction(
    sql: Sql,
    productId: string,
    storeId: string,
  ): Promise<ProductView | undefined> {
    const rows = await sql<ProductBaseRow[]>`
      select product.id as "productId", product.store_id as "storeId",
        product.state, product.revision,
        product.publication_version as "publicationVersion", working.definition
      from product_products product
      left join product_working_copies working on working.product_id = product.id
      where product.id = ${productId} and product.store_id = ${storeId}
    `;
    const row = rows[0];
    if (!row || !row.definition) return undefined;
    const definition = row.definition as unknown as StoredDefinition;
    const variants = await this.#readVariantRows(sql, productId);
    const byId = new Map(variants.map((variant) => [variant.variantId, variant]));
    const inventory = await Promise.all(
      definition.variants.map(async (variant) => {
        const snapshot = await this.inventory.readInTransaction(
          sql as unknown as InventoryTransactionContext,
          variantIdContract.parse(variant.variantId),
        );
        return snapshot
          ? { variantId: variant.variantId, ...snapshot }
          : { variantId: variant.variantId, onHand: 0, revision: 0 };
      }),
    );
    return productViewContract.parse({
      productId: row.productId,
      state: row.state,
      revision: row.revision,
      publicationVersion: row.publicationVersion,
      workingCopy: {
        name: definition.name,
        description: definition.description,
        orderedMediaIds: definition.orderedMediaIds,
        axes: definition.axes,
        variants: definition.variants.map((variant) => {
          const offer = byId.get(variant.variantId);
          return {
            ...variant,
            price:
              offer?.amount === null || offer?.amount === undefined
                ? null
                : { amount: Number(offer.amount), currency: "IRR" },
            sku: offer?.sku ?? null,
            offerRevision: offer?.offerRevision ?? 0,
          };
        }),
      },
      inventory,
    });
  }

  async #lockProductBase(sql: Sql, productId: string, storeId: string) {
    const rows = await sql<ProductBaseRow[]>`
      select product.id as "productId", product.store_id as "storeId",
        product.state, product.revision,
        product.publication_version as "publicationVersion", working.definition
      from product_products product
      left join product_working_copies working on working.product_id = product.id
      where product.id = ${productId} and product.store_id = ${storeId}
      for update of product
    `;
    if (!rows[0]) throw new ProductNotFoundError();
    return rows[0];
  }

  async #readVariantRows(
    sql: Sql,
    productId: string,
    lock = false,
    includeRetired = false,
  ) {
    return sql<VariantRow[]>`
      select variant.id as "variantId", variant.client_key as "clientKey",
        variant.combination_key as "combinationKey", offer.amount, offer.sku,
        offer.revision as "offerRevision"
      from product_variants variant
      left join product_offers offer on offer.variant_id = variant.id
      where variant.product_id = ${productId}
        ${includeRetired ? sql`` : sql`and variant.retired = false`}
      order by variant.created_at, variant.id
      ${lock ? sql`for update of variant` : sql``}
    `;
  }

  #requireRevision(current: ProductBaseRow, expectedRevision: number) {
    if (current.revision !== expectedRevision) {
      throw new ProductRevisionConflictError(expectedRevision, current.revision);
    }
  }

  async #claimSku(sql: Sql, storeId: string, variantId: string, sku: string | null) {
    if (!sku) return;
    const claimed = await sql<Array<{ variantId: string }>>`
      insert into product_sku_history (store_id, sku, variant_id)
      values (${storeId}, ${sku}, ${variantId})
      on conflict (store_id, sku) do update set sku = excluded.sku
      returning variant_id as "variantId"
    `;
    if (claimed[0]?.variantId !== variantId) throw new DuplicateSkuError();
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
        working.variant_id as "variantId", offer.amount,
        offer.revision as "offerVersion"
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

function normalizeText(value: string) {
  return value.trim().replace(/\s+/gu, " ");
}

function normalizeWorkingCopy(
  workingCopy: ReplaceProductWorkingCopy["workingCopy"],
): ReplaceProductWorkingCopy["workingCopy"] {
  return {
    ...workingCopy,
    name: workingCopy.name ? normalizeText(workingCopy.name) : null,
    description: normalizeText(workingCopy.description),
    axes: workingCopy.axes.map((axis) => ({
      ...axis,
      name: normalizeText(axis.name),
      values: axis.values.map((value) => ({
        ...value,
        name: normalizeText(value.name),
      })),
    })),
  };
}

function priceRange(amounts: number[]) {
  const minimum = Math.min(...amounts);
  const maximum = Math.max(...amounts);
  return {
    minimum: { amount: minimum, currency: "IRR" as const },
    maximum: { amount: maximum, currency: "IRR" as const },
  };
}

function toPublicMultivariant(view: ProductView, publicationVersion: number) {
  if (
    !view.workingCopy?.name ||
    view.workingCopy.orderedMediaIds.length === 0 ||
    view.workingCopy.variants.length === 0
  ) {
    throw new Error("Product publication is not ready");
  }
  const inventoryById = new Map(
    view.inventory.map((row) => [row.variantId, row.onHand]),
  );
  const axisByKey = new Map(
    view.workingCopy.axes.map((axis) => [axis.clientKey, axis]),
  );
  const variants = view.workingCopy.variants.map((variant) => {
    if (!variant.price) throw new Error("Product publication is not ready");
    return {
      variantId: variant.variantId,
      combination: variant.combination.map((entry) => {
        const axis = axisByKey.get(entry.axisClientKey)!;
        const value = axis.values.find(
          (candidate) => candidate.clientKey === entry.valueClientKey,
        )!;
        return { axis: axis.name, value: value.name };
      }),
      price: variant.price,
      availability:
        (inventoryById.get(variant.variantId) ?? 0) > 0
          ? ("AVAILABLE" as const)
          : ("OUT_OF_STOCK" as const),
    };
  });
  return publicProductContract.parse({
    productId: view.productId,
    name: view.workingCopy.name,
    description: view.workingCopy.description,
    images: view.workingCopy.orderedMediaIds.map((id) => ({
      id,
      url: `/v1/media/${id}`,
    })),
    axes: view.workingCopy.axes.map((axis) => ({
      name: axis.name,
      values: axis.values.map((value) => value.name),
    })),
    variants,
    priceRange: priceRange(variants.map((variant) => variant.price.amount)),
    availability: variants.some((variant) => variant.availability === "AVAILABLE")
      ? "AVAILABLE"
      : "OUT_OF_STOCK",
    publicationVersion,
  });
}

function toPublicMultivariantSummary(product: PublicProduct) {
  return publicProductSummaryContract.parse({
    productId: product.productId,
    name: product.name,
    image: product.images[0],
    priceRange: product.priceRange,
    availability: product.availability,
    publicationVersion: product.publicationVersion,
  });
}

function toPublicProduct(row: PublicationRow, onHand: number) {
  return publicSimpleProductContract.parse({
    productId: row.productId,
    variantId: row.variantId,
    name: row.name,
    description: row.description,
    image: { id: row.mediaId, url: `/v1/media/${row.mediaId}` },
    price: { amount: Number(row.amount), currency: "IRR" },
    availability: onHand > 0 ? "AVAILABLE" : "OUT_OF_STOCK",
    publicationVersion: row.publicationVersion,
  });
}

function toPublicSummary(product: ReturnType<typeof toPublicProduct>) {
  return publicSimpleProductSummaryContract.parse({
    productId: product.productId,
    name: product.name,
    image: product.image,
    price: product.price,
    availability: product.availability,
    publicationVersion: product.publicationVersion,
  });
}
