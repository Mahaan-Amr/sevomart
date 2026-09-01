import { cookies } from "next/headers";
import Link from "next/link";

import { formatIrrAsToman } from "../../../../../lib/format-money";
import { readSellerBasicReport } from "../../../../../lib/seller-reporting-api";
import workspaceStyles from "../workspace-page.module.css";
import styles from "./seller-reports.module.css";

export default async function SellerReportsPage() {
  const cookieStore = await cookies();
  const report = await readSellerBasicReport(cookieStore.toString());

  return (
    <main className={workspaceStyles.page}>
      <section
        className={workspaceStyles.workspace}
        aria-labelledby="seller-report-title"
      >
        <span className={workspaceStyles.eyebrow}>عملکرد خصوصی فروشگاه</span>
        <h1 id="seller-report-title">گزارش فروش</h1>
        {report.kind === "UNAVAILABLE" ? (
          <div className={styles.status}>
            <h2>گزارش دریافت نشد</h2>
            <p>کمی بعد دوباره این صفحه را بررسی کنید.</p>
          </div>
        ) : (
          <>
            <div className={styles.range} aria-label="بازه گزارش">
              <strong>۳۰ روز گذشته</strong>
              <span>از</span>
              <time dateTime={report.data.range.from}>
                {formatReportDate(report.data.range.from)}
              </time>
              <span>تا</span>
              <time dateTime={report.data.range.to}>
                {formatReportDate(report.data.range.to)}
              </time>
            </div>
            {report.data.orderCount === 0 ? (
              <div className={styles.status}>
                <h2>هنوز گزارشی برای این بازه نیست</h2>
                <p>در این بازه سفارشی ثبت نشده است.</p>
              </div>
            ) : (
              <dl className={styles.metrics}>
                <div>
                  <dt>فروش ثبت‌شده</dt>
                  <dd>{formatIrrAsToman(report.data.sales.amount)}</dd>
                </div>
                <div>
                  <dt>سفارش</dt>
                  <dd>{report.data.orderCount.toLocaleString("fa-IR")}</dd>
                </div>
                <div>
                  <dt>سفارش تکمیل‌شده</dt>
                  <dd>{report.data.completedOrderCount.toLocaleString("fa-IR")}</dd>
                </div>
              </dl>
            )}
          </>
        )}
        <Link className={workspaceStyles.secondary} href="/seller">
          بازگشت به کارهای نزدیک
        </Link>
      </section>
    </main>
  );
}

function formatReportDate(value: string) {
  return new Intl.DateTimeFormat("fa-IR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "Asia/Tehran",
  }).format(new Date(value));
}
