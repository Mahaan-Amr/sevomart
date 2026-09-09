import { firstParameter } from "../../../lib/navigation";
import Link from "next/link";
import { FeedView } from "./feed-view";
import styles from "./discovery.module.css";

export default async function DiscoveryPage({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string | string[] }>;
}) {
  const cursor = firstParameter((await searchParams).cursor);
  return (
    <>
      <header className={styles.intro}>
        <p className={styles.eyebrow}>خرید روشن از فروشگاه‌های مستقل</p>
        <h1>فروشگاه‌های تازه را در سوو کشف کنید</h1>
        <p>
          کالاها را ببینید، از خود فروشگاه بخرید و سفارش‌تان را در یک مسیر روشن پیگیری
          کنید.
        </p>
        <div className={styles.introActions}>
          <Link className={styles.primaryAction} href="#discovery-feed">
            خرید کنید
          </Link>
          <Link className={styles.secondaryAction} href="/seller/start">
            فروشنده شوید
          </Link>
        </div>
      </header>
      <section
        id="discovery-feed"
        className={styles.feedSection}
        aria-labelledby="discovery-title"
      >
        <h2 id="discovery-title">کشف تازه‌ها</h2>
        <FeedView kind="discovery" initialCursor={cursor} />
      </section>
    </>
  );
}
