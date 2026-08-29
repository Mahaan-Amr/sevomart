import { sellerActionableOrderListContract } from "@sevo/contracts/orders/v1";
import { cookies } from "next/headers";
import Link from "next/link";

import styles from "./workspace-page.module.css";

const API_BASE_URL = process.env.API_BASE_URL ?? "http://127.0.0.1:3001";

export default async function SellerHomePage() {
  const cookieStore = await cookies();
  const actionableOrders = await readActionableOrders(cookieStore.toString());
  return (
    <main className={styles.page}>
      <section className={styles.workspace} aria-labelledby="seller-home-title">
        <span className={styles.eyebrow}>فضای کار فروشنده</span>
        <h1 id="seller-home-title">کارهای نزدیک</h1>
        <p>سفارش، موجودی یا گفت‌وگویی که نیاز به رسیدگی داشته باشد اینجا می‌آید.</p>
        <div className={styles.nextAction}>
          {actionableOrders === undefined ? (
            <>
              <h2>کارهای نزدیک دریافت نشد</h2>
              <p>کمی بعد صفحه را دوباره بررسی کنید.</p>
            </>
          ) : actionableOrders > 0 ? (
            <>
              <h2>{actionableOrders.toLocaleString("fa-IR")} سفارش آماده رسیدگی است</h2>
              <p>پرداخت این سفارش‌ها ثبت شده و منتظر اقدام شما هستند.</p>
              <Link className={styles.primary} href="/seller/orders">
                رسیدگی به سفارش‌ها
              </Link>
            </>
          ) : (
            <>
              <h2>سفارش تازه‌ای برای رسیدگی نیست</h2>
              <p>برای کارهای دیگر، موجودی و گفت‌وگوها را از مسیر خودشان بررسی کنید.</p>
            </>
          )}
        </div>
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
