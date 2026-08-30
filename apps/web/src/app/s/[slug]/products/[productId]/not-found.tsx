import Link from "next/link";

import styles from "../../../../not-found.module.css";

export default function ProductNotFound() {
  return (
    <main>
      <section className={styles.panel} aria-labelledby="product-not-found-title">
        <h1 id="product-not-found-title">این کالا در دسترس نیست</h1>
        <p>
          ممکن است انتشار کالا متوقف شده باشد یا نشانی آن درست نباشد. برای خرید تازه،
          کالای دیگری را ببینید.
        </p>
        <Link href="/">دیدن کالاهای دیگر</Link>
        <Link href="/cart">دیدن سبد</Link>
      </section>
    </main>
  );
}
