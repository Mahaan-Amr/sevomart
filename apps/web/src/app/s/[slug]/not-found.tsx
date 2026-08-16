import Link from "next/link";

import styles from "./storefront.module.css";

export default function StorefrontNotFound() {
  return (
    <main className={styles.page}>
      <article className={styles.storefront}>
        <section className={styles.errorState}>
          <span className={styles.errorMark} aria-hidden="true">
            ؟
          </span>
          <h1>فروشگاه پیدا نشد</h1>
          <p>این فروشگاه هنوز منتشر نشده یا نشانی آن درست نیست.</p>
          <Link className={styles.retry} href="/">
            رفتن به سوو
          </Link>
        </section>
      </article>
    </main>
  );
}
