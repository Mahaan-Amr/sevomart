import Link from "next/link";

import styles from "../workspace-page.module.css";
import { SellerProductList } from "../../products/seller-product-list";

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
        <SellerProductList />
      </section>
    </main>
  );
}
