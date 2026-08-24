import { publicSimpleProductContract } from "@sevo/contracts/product/v1";
import { notFound } from "next/navigation";

import { formatIrrAsToman } from "../../../../../lib/format-money";
import { AddToCart } from "./add-to-cart";
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
          src={`/api/store/media/${product.image.id}`}
          alt={product.name}
        />
        <section className={styles.details}>
          <h1>{product.name}</h1>
          <p>{product.description}</p>
          <strong>{formatIrrAsToman(product.price.amount)}</strong>
          <span className={styles.availability}>
            {product.availability === "AVAILABLE" ? "موجود" : "ناموجود"}
          </span>
          <AddToCart
            variantId={product.variantId}
            available={product.availability === "AVAILABLE"}
          />
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
    const parsed = publicSimpleProductContract.safeParse(await response.json());
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}
