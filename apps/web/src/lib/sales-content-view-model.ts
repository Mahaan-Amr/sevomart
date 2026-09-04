import type {
  PublicSalesContentFeedV2,
  PublicSalesContentItemV2,
} from "@sevo/contracts/content/v2";

export type SalesContentProductView = Readonly<{
  productId: string;
  name: string;
  href: string;
  priceLabel: string;
  unavailable: boolean;
}>;

export type SalesContentCardView = Readonly<{
  contentId: string;
  sourceLabel: "محتوای فروش";
  storeId: string;
  media: PublicSalesContentItemV2["media"];
  product?: SalesContentProductView & {
    availabilityLabel?: "ناموجود";
  };
  unavailableLabel?: "کالای متصل فعلاً قابل خرید نیست.";
  publishedAt: string;
}>;

export function buildSalesContentCards(
  feed: PublicSalesContentFeedV2,
  products: readonly SalesContentProductView[],
  options: { includeContentWithoutVisibleProducts: boolean },
): SalesContentCardView[] {
  const productById = new Map(products.map((product) => [product.productId, product]));
  return feed.items.flatMap((content) => {
    const product = content.products
      .filter(({ active }) => active)
      .map(({ productId }) => productById.get(productId))
      .find((candidate) => candidate !== undefined);
    if (!product && !options.includeContentWithoutVisibleProducts) return [];
    return [
      {
        contentId: content.contentId,
        sourceLabel: "محتوای فروش",
        storeId: content.storeId,
        media: content.media,
        ...(product
          ? {
              product: {
                ...product,
                ...(product.unavailable
                  ? { availabilityLabel: "ناموجود" as const }
                  : {}),
              },
            }
          : {
              unavailableLabel: "کالای متصل فعلاً قابل خرید نیست." as const,
            }),
        publishedAt: content.publishedAt,
      },
    ];
  });
}
