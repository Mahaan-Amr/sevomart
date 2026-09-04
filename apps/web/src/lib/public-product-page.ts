import { productPurchaseExperiencesContract } from "@sevo/contracts/content/v2";
import {
  publicProductContract,
  publicSimpleProductContract,
} from "@sevo/contracts/product/v1";
import { publicStoreContract } from "@sevo/contracts/store/v1";

export async function readPublicProductPage(
  slug: string,
  productId: string,
  apiBaseUrl = process.env.API_BASE_URL ?? "http://127.0.0.1:3001",
) {
  try {
    const encodedSlug = encodeURIComponent(slug);
    const [productResponse, storeResponse, experiences] = await Promise.all([
      fetch(
        `${apiBaseUrl}/v1/stores/${encodedSlug}/products/${encodeURIComponent(productId)}`,
        {
          cache: "no-store",
          headers: { "x-correlation-id": crypto.randomUUID() },
        },
      ),
      fetch(`${apiBaseUrl}/v1/stores/${encodedSlug}`, {
        cache: "no-store",
        headers: { "x-correlation-id": crypto.randomUUID() },
      }),
      fetch(
        `${apiBaseUrl}/v2/products/${encodeURIComponent(productId)}/purchase-experiences`,
        {
          cache: "no-store",
          headers: { "x-correlation-id": crypto.randomUUID() },
        },
      )
        .then(async (response) => {
          if (!response.ok) return undefined;
          const parsed = productPurchaseExperiencesContract.safeParse(
            await response.json(),
          );
          return parsed.success ? parsed.data : undefined;
        })
        .catch(() => undefined),
    ]);
    if (productResponse.status === 404 || storeResponse.status === 404) {
      return { state: "not-found" } as const;
    }
    if (!productResponse.ok || !storeResponse.ok) return { state: "error" } as const;
    const body: unknown = await productResponse.json();
    const multivariant = publicProductContract.safeParse(body);
    const simple = publicSimpleProductContract.safeParse(body);
    const store = publicStoreContract.safeParse(await storeResponse.json());
    if ((!multivariant.success && !simple.success) || !store.success) {
      return { state: "error" } as const;
    }
    return {
      state: "ready" as const,
      product: multivariant.success ? multivariant.data : simple.data!,
      store: store.data,
      experiences,
    };
  } catch {
    return { state: "error" } as const;
  }
}
