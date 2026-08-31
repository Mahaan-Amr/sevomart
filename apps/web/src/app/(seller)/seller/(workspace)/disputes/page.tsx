import { cookies } from "next/headers";
import Link from "next/link";

import { readSellerDisputes } from "../../../../../lib/seller-dispute-api";
import {
  disputeCategoryTitle,
  disputeStatusTitle,
  formatDisputeTime,
} from "../../disputes/seller-dispute-copy";
import { formatOrderReference } from "../../disputes/seller-dispute-model";
import styles from "../../disputes/seller-disputes.module.css";

type Props = { searchParams: Promise<{ cursor?: string }> };

export default async function SellerDisputesPage({ searchParams }: Props) {
  const { cursor } = await searchParams;
  const result = await readSellerDisputes((await cookies()).toString(), cursor);

  return (
    <main className={styles.page}>
      <section className={styles.panel} aria-labelledby="disputes-title">
        <span className={styles.eyebrow}>پیگیری قابل اعتماد</span>
        <h1 id="disputes-title">پرونده‌های اختلاف سفارش</h1>
        <p className={styles.intro}>
          پرونده‌های همین فروشگاه را ببینید و فقط وقتی نوبت شماست پاسخ دهید.
        </p>

        {result.kind === "UNAVAILABLE" ? (
          <p className={styles.notice} role="alert">
            پرونده‌های اختلاف دریافت نشدند. کمی بعد دوباره تلاش کنید.
          </p>
        ) : null}
        {result.kind === "NOT_FOUND_OR_FORBIDDEN" ? (
          <p className={styles.notice}>
            پرونده اختلافی برای این فروشگاه در دسترس نیست.
          </p>
        ) : null}
        {result.kind === "OK" && result.data.items.length === 0 ? (
          <p className={styles.notice}>فعلاً پرونده اختلافی برای این فروشگاه نیست.</p>
        ) : null}

        {result.kind === "OK" ? (
          <ul className={styles.list}>
            {result.data.items.map((dispute) => (
              <li key={dispute.disputeId}>
                <div className={styles.caseIdentity}>
                  <strong>{disputeCategoryTitle(dispute.category)}</strong>
                  <span>شماره سفارش {formatOrderReference(dispute.orderId)}</span>
                </div>
                <div className={styles.caseState}>
                  <span>{disputeStatusTitle(dispute.status)}</span>
                  {dispute.deadline ? (
                    <time dateTime={dispute.deadline.dueAt}>
                      مهلت: {formatDisputeTime(dispute.deadline.dueAt)}
                    </time>
                  ) : null}
                </div>
                <Link href={`/seller/disputes/${dispute.disputeId}`}>
                  {dispute.nextAction.actorKind === "SELLER"
                    ? "پاسخ به پرونده"
                    : "دیدن پرونده"}
                </Link>
              </li>
            ))}
          </ul>
        ) : null}

        {result.kind === "OK" && result.data.nextCursor ? (
          <Link
            className={styles.secondary}
            href={`/seller/disputes?cursor=${encodeURIComponent(result.data.nextCursor)}`}
          >
            پرونده‌های بعدی
          </Link>
        ) : null}
      </section>
    </main>
  );
}
