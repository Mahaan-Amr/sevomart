import Link from "next/link";
import styles from "./not-found.module.css";

export default function NotFoundPage() {
  return (
    <main>
      <section className={styles.panel} aria-labelledby="not-found-title">
        <h1 id="not-found-title">این صفحه پیدا نشد</h1>
        <p>ممکن است نشانی درست نباشد یا این صفحه دیگر در دسترس نباشد.</p>
        <Link href="/">بازگشت به کشف</Link>
        <Link href="/cart">دیدن سبد</Link>
      </section>
    </main>
  );
}
