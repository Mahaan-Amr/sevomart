import { sellerOperationalTaskContract } from "@sevo/contracts/reporting-analytics/v1";
import { cookies } from "next/headers";
import Link from "next/link";

import { readNearestSellerConversation } from "../../../../lib/seller-conversation-api";
import {
  readSellerOperationalSummary,
  readSellerOutOfStockCount,
} from "../../../../lib/seller-reporting-api";
import styles from "./workspace-page.module.css";

export default async function SellerHomePage() {
  const cookieStore = await cookies();
  const cookieHeader = cookieStore.toString();
  const [summary, actionableConversation, outOfStock] = await Promise.all([
    readSellerOperationalSummary(cookieHeader),
    readNearestSellerConversation(cookieHeader),
    readSellerOutOfStockCount(cookieHeader),
  ]);
  const tasks =
    summary.kind === "OK" ? summary.data.tasks.filter(({ count }) => count > 0) : [];
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
          {summary.kind === "UNAVAILABLE" && !conversationHref && !hasOutOfStock ? (
            <>
              <h2>کارهای نزدیک دریافت نشد</h2>
              <p>کمی بعد صفحه را دوباره بررسی کنید.</p>
            </>
          ) : tasks.length > 0 || conversationHref || hasOutOfStock ? (
            <ul className={styles.taskList}>
              {tasks.map((task) => (
                <OperationalTask key={task.kind} task={task} />
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

function OperationalTask({ task }: { task: SellerOperationalTask }) {
  const copy = {
    NEW_ORDERS: {
      title: `${task.count.toLocaleString("fa-IR")} سفارش تازه آماده رسیدگی است`,
      description: "پرداخت این سفارش‌ها ثبت شده و منتظر اقدام شما هستند.",
      action: "رسیدگی به سفارش‌ها",
      href: "/seller/orders",
    },
    OVERDUE_PREPARATIONS: {
      title: `${task.count.toLocaleString("fa-IR")} سفارش بیش از ۲۴ ساعت در حال آماده‌سازی است`,
      description: "وضعیت آماده‌سازی را بررسی و قدم بعدی سفارش را ثبت کنید.",
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
