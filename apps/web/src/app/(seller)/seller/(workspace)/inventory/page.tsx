import styles from "../workspace-page.module.css";

export default function SellerInventoryPage() {
  return (
    <main className={styles.page}>
      <section className={styles.workspace}>
        <span className={styles.eyebrow}>موجودی</span>
        <h1>مدیریت موجودی هنوز فعال نیست</h1>
        <p>
          این مسیر برای مدیریت مستقل موجودی آماده شده است، اما تا تکمیل ثبت ممیزی‌شده
          تغییرات، ویرایش موجودی از اینجا فعال نمی‌شود.
        </p>
        <p>فعلاً موجودی هر گونه در مسیر ساخت همان کالا ثبت می‌شود.</p>
      </section>
    </main>
  );
}
