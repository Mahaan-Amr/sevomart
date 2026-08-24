import {
  publicProductContract,
  publicSimpleProductContract,
  type PublicProduct,
  type PublicSimpleProduct,
} from "@sevo/contracts/product/v1";
import { notFound } from "next/navigation";

import { formatIrrAsToman } from "../../../../../lib/format-money";
import styles from "./product-public.module.css";

const API_BASE_URL = process.env.API_BASE_URL ?? "http://127.0.0.1:3001";

export default async function PublicProductPage({
  params,
}: {
  params: Promise<{ slug: string; productId: string }>;
}) {
  const { slug, productId } = await params;
  const product = await readProduct(slug, productId);
  if (!product) notFound();

  return (
    <main className={styles.page}>
      <article className={styles.product}>
        <a className={styles.back} href={`/s/${slug}`}>
          بازگشت به فروشگاه
        </a>
        <img
          className={styles.image}
          src={`/api/store/media/${productImageId(product)}`}
          alt={product.name}
        />
        <section className={styles.details}>
          <h1>{product.name}</h1>
          <p>{product.description}</p>
          <strong>{formatProductPrice(product)}</strong>
          <span className={styles.availability}>
            {product.availability === "AVAILABLE" ? "موجود" : "ناموجود"}
          </span>
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
          <p className={styles.payment}>
            روش پرداخت و شرایط مرجوعی پیش از ثبت سفارش نمایش داده می‌شود.
          </p>
        </section>
        <footer>ساخته‌شده با سوو</footer>
      </article>
    </main>
  );
}

async function readProduct(slug: string, productId: string) {
  try {
    const response = await fetch(
      `${API_BASE_URL}/v1/stores/${encodeURIComponent(slug)}/products/${encodeURIComponent(productId)}`,
      { cache: "no-store", headers: { "x-correlation-id": crypto.randomUUID() } },
    );
    if (!response.ok) return undefined;
    const body: unknown = await response.json();
    const multivariant = publicProductContract.safeParse(body);
    if (multivariant.success) return multivariant.data;
    const simple = publicSimpleProductContract.safeParse(body);
    return simple.success ? simple.data : undefined;
  } catch {
    return undefined;
  }
}

function productImageId(product: PublicProduct | PublicSimpleProduct) {
  return "images" in product ? product.images[0]!.id : product.image.id;
}

function formatProductPrice(product: PublicProduct | PublicSimpleProduct) {
  if (!("priceRange" in product)) return formatIrrAsToman(product.price.amount);
  const { minimum, maximum } = product.priceRange;
  return minimum.amount === maximum.amount
    ? formatIrrAsToman(minimum.amount)
    : `از ${formatIrrAsToman(minimum.amount)} تا ${formatIrrAsToman(maximum.amount)}`;
}
