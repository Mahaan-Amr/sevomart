import Link from "next/link";

import styles from "./seller-start.module.css";

export default function SellerStartPage() {
  return (
    <main className={styles.page}>
      <section className={styles.panel} aria-labelledby="seller-start-title">
        <Link className={styles.brand} href="/">
          سوو
        </Link>
        <p className={styles.eyebrow}>شروع فروش در سوو</p>
        <h1 id="seller-start-title">فروشگاه خودتان را روشن و قابل پیگیری بسازید</h1>
        <p>
          در سوو کالاها، سفارش‌ها و گفت‌وگوهای فروشگاه‌تان را در یک مسیر مشخص مدیریت
          می‌کنید. ثبت درخواست به‌معنای تأیید خودکار فروشندگی نیست.
        </p>
        <dl className={styles.facts}>
          <div>
            <dt>تسویه در نسخه فعلی</dt>
            <dd>
              مبلغ مستقیماً برای فروشگاه تسویه می‌شود و روش پرداخت پیش از سفارش به
              خریدار نمایش داده می‌شود.
            </dd>
          </div>
          <div>
            <dt>مسئولیت فروشگاه</dt>
            <dd>
              قیمت، موجودی، ارسال و سیاست مرجوعی باید دقیق و به‌روز نگه داشته شوند.
            </dd>
          </div>
          <div>
            <dt>نقش سوو</dt>
            <dd>
              سوو مسیر ثبت و پیگیری مشکل را فراهم می‌کند، اما بازپرداخت را تضمین
              نمی‌کند.
            </dd>
          </div>
        </dl>
        <div className={styles.actions}>
          <Link className={styles.primary} href="/seller/application">
            شروع درخواست فروشندگی
          </Link>
          <Link className={styles.secondary} href="/">
            بازگشت به کشف
          </Link>
        </div>
      </section>
    </main>
  );
}
