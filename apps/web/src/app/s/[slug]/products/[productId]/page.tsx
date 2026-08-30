import {
  publicProductContract,
  publicSimpleProductContract,
  type PublicProduct,
  type PublicSimpleProduct,
} from "@sevo/contracts/product/v1";
import { publicStoreContract } from "@sevo/contracts/store/v1";
import { notFound } from "next/navigation";

import { formatIrrAsToman } from "../../../../../lib/format-money";
import { newProductConversationHref } from "../../../../../lib/conversation-navigation";
import { AddToCart } from "./add-to-cart";
import styles from "./product-public.module.css";

const API_BASE_URL = process.env.API_BASE_URL ?? "http://127.0.0.1:3001";

export default async function PublicProductPage({
  params,
}: {
  params: Promise<{ slug: string; productId: string }>;
}) {
  const { slug, productId } = await params;
  const result = await readProductPage(slug, productId);
  if (result.state === "not-found") notFound();
  if (result.state === "error")
    return <ProductPageError retryHref={`/s/${slug}/products/${productId}`} />;
  const { product, store } = result;
  const multivariant = "variants" in product && product.variants.length > 1;

  return (
    <main className={styles.page}>
      <article className={styles.product}>
        <a className={styles.back} href={`/s/${slug}`}>
          بازگشت به فروشگاه
        </a>
        <div className={styles.gallery} aria-label="تصویرهای کالا">
          {productImages(product).map((image, index) => (
            <img
              className={styles.image}
              src={`/api/store/media/${image.id}`}
              alt={index === 0 ? product.name : `${product.name}، تصویر ${index + 1}`}
              key={image.id}
            />
          ))}
        </div>
        <section className={styles.details}>
          <h1>{product.name}</h1>
          <p>{product.description}</p>
          {!multivariant ? (
            <>
              <strong>{formatProductPrice(product)}</strong>
              <span className={styles.availability}>
                {product.availability === "AVAILABLE" ? "موجود" : "ناموجود"}
              </span>
            </>
          ) : null}
          {"axes" in product && product.axes.length > 0 ? (
            <dl className={styles.axes} aria-label="ویژگی‌های کالا">
              {product.axes.map((axis) => (
                <div key={axis.name}>
                  <dt>{axis.name}</dt>
                  <dd>{axis.values.join("، ")}</dd>
                </div>
              ))}
            </dl>
          ) : null}
          {"variants" in product && product.variants.length > 1 ? (
            <ul className={styles.variants} aria-label="گونه‌های کالا">
              {product.variants.map((variant) => (
                <li key={variant.variantId}>
                  <span>
                    {variant.combination.map((part) => part.value).join("، ")}
                  </span>
                  <span>
                    {formatIrrAsToman(variant.price.amount)} ·{" "}
                    {variant.availability === "AVAILABLE" ? "موجود" : "ناموجود"}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          <AddToCart variants={cartVariants(product)} />
          <section className={styles.purchaseTerms} aria-labelledby="store-title">
            <span id="store-title">فروشگاه</span>
            <strong>{store.name}</strong>
          </section>
          <section className={styles.purchaseTerms} aria-labelledby="shipping-title">
            <span id="shipping-title">روش‌های ارسال</span>
            {store.shippingMethods
              .filter((method) => method.enabled)
              .map((method) => (
                <p key={method.id}>
                  <strong>{method.label}</strong> — {method.estimatedDeliveryText}
                </p>
              ))}
          </section>
          <a
            className={styles.conversation}
            href={newProductConversationHref(
              slug,
              product.productId,
              `/s/${slug}/products/${product.productId}`,
            )}
          >
            پرسیدن درباره این کالا
          </a>
          <section className={styles.purchaseTerms} aria-labelledby="returns-title">
            <span id="returns-title">شرایط مرجوعی</span>
            <strong>{store.returnPolicy}</strong>
            <p>این سیاست را فروشنده اعلام کرده است.</p>
          </section>
          <p className={styles.payment}>
            روش پرداخت پیش از ثبت سفارش نمایش داده می‌شود.
          </p>
        </section>
        <footer>ساخته‌شده با سوو</footer>
      </article>
    </main>
  );
}

async function readProductPage(slug: string, productId: string) {
  try {
    const encodedSlug = encodeURIComponent(slug);
    const [productResponse, storeResponse] = await Promise.all([
      fetch(
        `${API_BASE_URL}/v1/stores/${encodedSlug}/products/${encodeURIComponent(productId)}`,
        {
          cache: "no-store",
          headers: { "x-correlation-id": crypto.randomUUID() },
        },
      ),
      fetch(`${API_BASE_URL}/v1/stores/${encodedSlug}`, {
        cache: "no-store",
        headers: { "x-correlation-id": crypto.randomUUID() },
      }),
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
    };
  } catch {
    return { state: "error" } as const;
  }
}

function productImages(product: PublicProduct | PublicSimpleProduct) {
  return "images" in product ? product.images : [product.image];
}

function ProductPageError({ retryHref }: { retryHref: string }) {
  return (
    <main className={styles.page}>
      <section className={styles.error} role="alert">
        <h1>کالا فعلاً نمایش داده نمی‌شود</h1>
        <p>ارتباط با سوو کامل نشد. چند لحظه دیگر دوباره تلاش کنید.</p>
        <a href={retryHref}>تلاش دوباره</a>
      </section>
    </main>
  );
}

function formatProductPrice(product: PublicProduct | PublicSimpleProduct) {
  if (!("priceRange" in product)) return formatIrrAsToman(product.price.amount);
  const { minimum, maximum } = product.priceRange;
  return minimum.amount === maximum.amount
    ? formatIrrAsToman(minimum.amount)
    : `از ${formatIrrAsToman(minimum.amount)} تا ${formatIrrAsToman(maximum.amount)}`;
}

function cartVariants(product: PublicProduct | PublicSimpleProduct) {
  if (!("variants" in product)) {
    return [
      {
        variantId: product.variantId,
        label: product.name,
        priceLabel: formatIrrAsToman(product.price.amount),
        available: product.availability === "AVAILABLE",
      },
    ];
  }
  return product.variants.map((variant) => ({
    variantId: variant.variantId,
    label: variant.combination.map((part) => part.value).join("، ") || product.name,
    priceLabel: formatIrrAsToman(variant.price.amount),
    available: variant.availability === "AVAILABLE",
  }));
}
