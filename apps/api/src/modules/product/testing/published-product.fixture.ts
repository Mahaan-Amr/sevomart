import type { ProductId, StoreId } from "@sevo/contracts/platform/v1";
import postgres from "postgres";

export async function createPublishedProductFixture(
  databaseUrl: string,
  input: {
    productId: ProductId;
    storeId: StoreId;
    mediaId: string;
    variantId: string;
  },
) {
  const sql = postgres(databaseUrl, { max: 1 });
  const price = { amount: 1_000, currency: "IRR" };
  const snapshot = {
    productId: input.productId,
    name: "کالای محتوای آزمون",
    description: "",
    images: [{ id: input.mediaId, url: `/v1/media/${input.mediaId}` }],
    axes: [],
    variants: [
      {
        variantId: input.variantId,
        combination: [],
        price,
        availability: "AVAILABLE",
      },
    ],
    priceRange: { minimum: price, maximum: price },
    availability: "AVAILABLE",
    publicationVersion: 1,
  };
  await sql`
    insert into product_products
      (id, store_id, state, revision, publication_version, published_at)
    values (${input.productId}, ${input.storeId}, 'PUBLISHED', 1, 1, now())
  `;
  await sql`
    insert into product_publications
      (product_id, publication_version, name, description, media_id, variant_id,
       snapshot)
    values
      (${input.productId}, 1, 'کالای محتوای آزمون', '', ${input.mediaId},
       ${input.variantId}, ${sql.json(snapshot)})
  `;

  return {
    async cleanup() {
      try {
        await sql`delete from product_products where id = ${input.productId}`;
      } finally {
        await sql.end();
      }
    },
  };
}
