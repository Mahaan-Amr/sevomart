import Link from "next/link";

import styles from "./workspace-page.module.css";

export default function SellerHomePage() {
  return (
    <main className={styles.page}>
      <section className={styles.workspace} aria-labelledby="seller-home-title">
        <span className={styles.eyebrow}>فضای کار فروشنده</span>
        <h1 id="seller-home-title">کارهای نزدیک</h1>
        <p>از همین‌جا نزدیک‌ترین کار فروشگاه را انجام دهید.</p>
        <div className={styles.nextAction}>
          <h2>فروشگاه را برای خرید آماده کنید</h2>
          <p>اطلاعات، روش ارسال و شرایط مرجوعی را مرور کنید.</p>
          <Link className={styles.primary} href="/seller/store">
            دیدن وضعیت فروشگاه
          </Link>
        </div>
      </section>
    </main>
  );
}
