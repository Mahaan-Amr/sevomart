import { sellerOperationalTaskContract } from "@sevo/contracts/reporting-analytics/v1";
import { cookies } from "next/headers";
import Link from "next/link";

import { readNearestSellerConversation } from "../../../../lib/seller-conversation-api";
import { readAllSellerDisputes } from "../../../../lib/seller-dispute-api";
import { readSellerOutOfStockCount } from "../../../../lib/seller-inventory-summary-api";
import { readSellerOperationalSummary } from "../../../../lib/seller-reporting-api";
import { formatDisputeTime } from "../disputes/seller-dispute-copy";
import { nearestSellerResponseDispute } from "../disputes/seller-dispute-model";
import styles from "./workspace-page.module.css";

export default async function SellerHomePage() {
  const cookieStore = await cookies();
  const cookieHeader = cookieStore.toString();
  const [summary, actionableConversation, outOfStock, disputePage] = await Promise.all([
    readSellerOperationalSummary(cookieHeader),
    readNearestSellerConversation(cookieHeader),
    readSellerOutOfStockCount(cookieHeader),
    readAllSellerDisputes(cookieHeader),
  ]);
  const actionableDispute =
    disputePage.kind === "OK"
      ? nearestSellerResponseDispute(disputePage.data)
      : undefined;
  const tasks =
    summary.kind === "OK"
      ? summary.data.tasks.filter(
          ({ count, kind }) =>
            count > 0 && !(actionableDispute && kind === "AWAITING_DISPUTE_RESPONSES"),
        )
      : [];
  const preparationOverdueAfterHours =
    summary.kind === "OK" ? summary.data.preparationOverdueAfterHours : undefined;
  const conversationHref =
    actionableConversation.kind === "ACTIONABLE"
      ? `/seller/conversations/${actionableConversation.conversation.conversationId}`
      : undefined;
  const outOfStockCount = outOfStock.kind === "OK" ? outOfStock.data : 0;
  const hasOutOfStock = outOfStockCount > 0;
  return (
    <main className={styles.page}>
      <section className={styles.workspace} aria-labelledby="seller-home-title">
        <span className={styles.eyebrow}>فضای کار فروشنده</span>
        <h1 id="seller-home-title">کارهای نزدیک</h1>
        <p>
          سفارش، موجودی، گفت‌وگو یا پرونده اختلافی که نیاز به رسیدگی داشته باشد اینجا
          می‌آید.
        </p>
        <div className={styles.nextAction}>
          {summary.kind === "UNAVAILABLE" &&
          !conversationHref &&
          !hasOutOfStock &&
          !actionableDispute ? (
            <>
              <h2>فهرست کارها دریافت نشد</h2>
              <p>کمی بعد صفحه را دوباره بررسی کنید.</p>
            </>
          ) : tasks.length > 0 ||
            conversationHref ||
            hasOutOfStock ||
            actionableDispute ? (
            <ul className={styles.taskList}>
              {actionableDispute ? (
                <li>
                  <div>
                    <h2>یک پرونده اختلاف منتظر پاسخ فروشگاه است</h2>
                    <p>
                      مهلت پاسخ: {formatDisputeTime(actionableDispute.deadline!.dueAt)}
                    </p>
                  </div>
                  <Link
                    className={styles.secondary}
                    href={`/seller/disputes/${actionableDispute.disputeId}`}
                  >
                    پاسخ به پرونده اختلاف
                  </Link>
                </li>
              ) : null}
              {tasks.map((task) => (
                <OperationalTask
                  key={task.kind}
                  task={task}
                  preparationOverdueAfterHours={preparationOverdueAfterHours!}
                />
              ))}
              {hasOutOfStock ? (
                <li>
                  <div>
                    <h2>
                      {outOfStockCount.toLocaleString("fa-IR")} گونه کالا موجودی ندارد
                    </h2>
                    <p>موجودی واقعی را بررسی و شمارش تازه را ثبت کنید.</p>
                  </div>
                  <Link className={styles.secondary} href="/seller/inventory">
                    رسیدگی به موجودی
                  </Link>
                </li>
              ) : null}
              {conversationHref ? (
                <li>
                  <div>
                    <h2>یک گفت‌وگو منتظر پاسخ شماست</h2>
                    <p>تازه‌ترین پیام خریدار را در زمینه همان فروشگاه بررسی کنید.</p>
                  </div>
                  <Link className={styles.secondary} href={conversationHref}>
                    پاسخ به گفت‌وگو
                  </Link>
                </li>
              ) : null}
            </ul>
          ) : (
            <>
              <h2>سفارش تازه‌ای برای رسیدگی نیست</h2>
              <p>
                برای کارهای دیگر، موجودی، گفت‌وگوها و پرونده‌های اختلاف را از مسیر
                خودشان بررسی کنید.
              </p>
            </>
          )}
        </div>
        <nav className={styles.relatedActions} aria-label="کارهای مرتبط">
          <Link className={styles.secondary} href="/seller/conversations">
            دیدن همه گفت‌وگوها
          </Link>
          <Link className={styles.secondary} href="/seller/reports">
            دیدن گزارش فروش
          </Link>
        </nav>
      </section>
    </main>
  );
}

type SellerOperationalTask = ReturnType<typeof sellerOperationalTaskContract.parse>;

function OperationalTask({
  task,
  preparationOverdueAfterHours,
}: {
  task: SellerOperationalTask;
  preparationOverdueAfterHours: number;
}) {
  const copy = {
    NEW_ORDERS: {
      title: `${task.count.toLocaleString("fa-IR")} سفارش تازه آماده رسیدگی است`,
      description: "پرداخت این سفارش‌ها ثبت شده و منتظر اقدام شما هستند.",
      action: "رسیدگی به سفارش‌ها",
      href: "/seller/orders",
    },
    OVERDUE_PREPARATIONS: {
      title: `${task.count.toLocaleString("fa-IR")} سفارش بیش از ${preparationOverdueAfterHours.toLocaleString("fa-IR")} ساعت در حال آماده‌سازی است`,
      description:
        "وضعیت آماده‌سازی این سفارش‌ها را بررسی کنید؛ اگر بسته آماده است، قدم بعدی و اطلاعات ارسال را ثبت کنید تا خریدار بداند سفارش در چه مرحله‌ای است.",
      action: "بررسی آماده‌سازی‌ها",
      href: "/seller/orders?status=preparing",
    },
    AWAITING_DISPUTE_RESPONSES: {
      title: `${task.count.toLocaleString("fa-IR")} پرونده اختلاف منتظر پاسخ فروشگاه است`,
      description: "پاسخ و مدارک فروشگاه را پیش از پایان مهلت ثبت کنید.",
      action: "پاسخ به پرونده‌ها",
      href: "/seller/disputes",
    },
  }[task.kind];

  return (
    <li>
      <div>
        <h2>{copy.title}</h2>
        <p>{copy.description}</p>
      </div>
      <Link className={styles.secondary} href={copy.href}>
        {copy.action}
      </Link>
    </li>
  );
}
