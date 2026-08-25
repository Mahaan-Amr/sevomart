import { productIdContract, storeIdContract } from "@sevo/contracts/platform/v1";

import type { ProductAuthoritativeRead } from "../../product/public";
import type { StoreAuthoritativeRead } from "../../store/public";
import type { DiscoveryFeedProjectionCandidate } from "../public";

export async function enrichDiscoveryFeedCandidate(
  projection: DiscoveryFeedProjectionCandidate,
  stores: StoreAuthoritativeRead,
  products: ProductAuthoritativeRead,
) {
  const productId = productIdContract.parse(projection.productId);
  const storeId = storeIdContract.parse(projection.storeId);
  const [store, detailedProduct] = await Promise.all([
    stores.readStore(storeId),
    products.readPublishedProduct(productId, storeId),
  ]);
  const product = detailedProduct ?? (await products.readPublished(productId, storeId));
  const storeName = store?.displayIdentity.name;
  if (
    !store ||
    store.publicationStatus !== "PUBLISHED" ||
    !store.settlement ||
    !store.slug ||
    !storeName ||
    !product
  ) {
    return undefined;
  }
  const isDetailed = "priceRange" in product;
  const image = isDetailed ? product.images[0] : product.image;
  if (!image) return undefined;
  return {
    productId,
    storeId,
    storeSlug: store.slug,
    store: {
      name: storeName,
      logo: store.displayIdentity.logoMediaId
        ? {
            id: store.displayIdentity.logoMediaId,
            url: `/v1/media/${store.displayIdentity.logoMediaId}`,
          }
        : null,
    },
    product: { name: product.name, image: { id: image.id, url: image.url } },
    priceRange: isDetailed
      ? product.priceRange
      : { minimum: product.price, maximum: product.price },
    availability: product.availability,
    projectionVersions: {
      store: projection.storePublicationVersion,
      publication: projection.publicationVersion,
      offer: projection.offerVersion,
      availability: projection.availabilityVersion,
    },
  };
}
