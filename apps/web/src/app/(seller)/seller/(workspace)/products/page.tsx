import Link from "next/link";

import styles from "../workspace-page.module.css";
import { LastProductLink } from "../../products/last-product-link";

export default function SellerProductsPage() {
  return (
    <main className={styles.page}>
      <section className={styles.workspace} aria-labelledby="seller-products-title">
        <span className={styles.eyebrow}>کالاها</span>
        <h1 id="seller-products-title">کالاهای فروشگاه</h1>
        <p>کالای فیزیکی تازه را قدم‌به‌قدم بسازید و پیش از انتشار مرور کنید.</p>
        <Link className={styles.primary} href="/seller/products/new">
          ساخت کالای تازه
        </Link>
        <LastProductLink className={styles.secondary} />
      </section>
    </main>
  );
}
