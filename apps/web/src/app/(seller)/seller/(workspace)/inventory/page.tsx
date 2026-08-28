import Link from "next/link";

import styles from "../workspace-page.module.css";

export default function SellerInventoryPage() {
  return (
    <main className={styles.page}>
      <section className={styles.workspace} aria-labelledby="seller-inventory-title">
        <span className={styles.eyebrow}>موجودی</span>
        <h1 id="seller-inventory-title">مدیریت موجودی</h1>
        <p>موجودی هر گونه هنگام ساخت یا ویرایش همان کالا ثبت می‌شود.</p>
        <Link className={styles.primary} href="/seller/products">
          رفتن به کالاها
        </Link>
      </section>
    </main>
  );
}
