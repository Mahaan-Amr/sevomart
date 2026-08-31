import { sellerActionableOrderListContract } from "@sevo/contracts/orders/v1";
import { cookies } from "next/headers";
import Link from "next/link";

import { readNearestSellerConversation } from "../../../../lib/seller-conversation-api";
import { readSellerDisputes } from "../../../../lib/seller-dispute-api";
import { formatDisputeTime } from "../disputes/seller-dispute-copy";
import { nearestSellerResponseDispute } from "../disputes/seller-dispute-model";
import styles from "./workspace-page.module.css";

const API_BASE_URL = process.env.API_BASE_URL ?? "http://127.0.0.1:3001";

export default async function SellerHomePage() {
  const cookieStore = await cookies();
  const cookieHeader = cookieStore.toString();
  const [actionableOrders, actionableConversation, disputePage] = await Promise.all([
    readActionableOrders(cookieHeader),
    readNearestSellerConversation(cookieHeader),
    readSellerDisputes(cookieHeader, undefined, 100),
  ]);
  const actionableDispute =
    disputePage.kind === "OK"
      ? nearestSellerResponseDispute(disputePage.data.items)
      : undefined;
  const conversationHref =
    actionableConversation.kind === "ACTIONABLE"
      ? `/seller/conversations/${actionableConversation.conversation.conversationId}`
      : undefined;
  return (
    <main className={styles.page}>
      <section className={styles.workspace} aria-labelledby="seller-home-title">
        <span className={styles.eyebrow}>فضای کار فروشنده</span>
        <h1 id="seller-home-title">کارهای نزدیک</h1>
        <p>سفارش، موجودی یا گفت‌وگویی که نیاز به رسیدگی داشته باشد اینجا می‌آید.</p>
        <div className={styles.nextAction}>
          {actionableDispute ? (
            <>
              <h2>یک اختلاف منتظر پاسخ فروشگاه است</h2>
              <p>مهلت پاسخ: {formatDisputeTime(actionableDispute.deadline!.dueAt)}</p>
              <Link
                className={styles.primary}
                href={`/seller/disputes/${actionableDispute.disputeId}`}
              >
                پاسخ به اختلاف
              </Link>
            </>
          ) : actionableOrders === undefined &&
            !conversationHref &&
            disputePage.kind === "UNAVAILABLE" ? (
            <>
              <h2>کارهای نزدیک دریافت نشد</h2>
              <p>کمی بعد صفحه را دوباره بررسی کنید.</p>
            </>
          ) : (actionableOrders ?? 0) > 0 ? (
            <>
              <h2>
                {(actionableOrders ?? 0).toLocaleString("fa-IR")} سفارش آماده رسیدگی است
              </h2>
              <p>پرداخت این سفارش‌ها ثبت شده و منتظر اقدام شما هستند.</p>
              <Link className={styles.primary} href="/seller/orders">
                رسیدگی به سفارش‌ها
              </Link>
            </>
          ) : conversationHref ? (
            <>
              <h2>یک گفت‌وگو منتظر پاسخ شماست</h2>
              <p>تازه‌ترین پیام خریدار را در زمینه همان فروشگاه بررسی کنید.</p>
              <Link className={styles.primary} href={conversationHref}>
                پاسخ به گفت‌وگو
              </Link>
            </>
          ) : (
            <>
              <h2>سفارش تازه‌ای برای رسیدگی نیست</h2>
              <p>برای کارهای دیگر، موجودی و گفت‌وگوها را از مسیر خودشان بررسی کنید.</p>
            </>
          )}
        </div>
        <nav className={styles.relatedActions} aria-label="کارهای مرتبط">
          {actionableDispute && (actionableOrders ?? 0) > 0 ? (
            <Link className={styles.secondary} href="/seller/orders">
              رسیدگی به سفارش‌ها
            </Link>
          ) : null}
          {(actionableOrders ?? 0) > 0 && conversationHref ? (
            <Link className={styles.secondary} href={conversationHref}>
              پاسخ به نزدیک‌ترین گفت‌وگو
            </Link>
          ) : null}
          <Link className={styles.secondary} href="/seller/conversations">
            دیدن همه گفت‌وگوها
          </Link>
          <Link className={styles.secondary} href="/seller/disputes">
            دیدن همه اختلاف‌ها
          </Link>
        </nav>
      </section>
    </main>
  );
}

async function readActionableOrders(cookieHeader: string) {
  try {
    const response = await fetch(`${API_BASE_URL}/v1/seller/orders`, {
      headers: { cookie: cookieHeader },
      cache: "no-store",
    });
    if (response.status === 404) return 0;
    if (!response.ok) return undefined;
    const parsed = sellerActionableOrderListContract.safeParse(await response.json());
    return parsed.success ? parsed.data.orders.length : undefined;
  } catch {
    return undefined;
  }
}
