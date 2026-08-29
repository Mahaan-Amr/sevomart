"use client";

import { storeDraftContract, type StoreDraft } from "@sevo/contracts/store/v1";
import Link from "next/link";
import { useEffect, useState } from "react";

import styles from "../(workspace)/workspace-page.module.css";

type StoreState =
  | { kind: "LOADING" }
  | { kind: "EMPTY" }
  | { kind: "READY"; store: StoreDraft }
  | { kind: "UNAVAILABLE" };

export function StoreStatus() {
  const [state, setState] = useState<StoreState>({ kind: "LOADING" });

  useEffect(() => {
    let active = true;
    void fetch("/api/store/seller/store/draft", { cache: "no-store" })
      .then(async (response) => {
        if (response.status === 404) return { kind: "EMPTY" } as const;
        const parsed = storeDraftContract.safeParse(await response.json());
        if (!response.ok || !parsed.success) return { kind: "UNAVAILABLE" } as const;
        return { kind: "READY", store: parsed.data } as const;
      })
      .catch(() => ({ kind: "UNAVAILABLE" }) as const)
      .then((next) => {
        if (active) setState(next);
      });
    return () => {
      active = false;
    };
  }, []);

  if (state.kind === "LOADING") {
    return <p aria-live="polite">در حال بررسی وضعیت فروشگاه…</p>;
  }
  if (state.kind === "UNAVAILABLE") {
    return (
      <div className={styles.nextAction} role="alert">
        <h2>وضعیت فروشگاه دریافت نشد</h2>
        <p>کمی بعد دوباره تلاش کنید.</p>
      </div>
    );
  }
  if (state.kind === "EMPTY") {
    return (
      <div className={styles.nextAction}>
        <h2>راه‌اندازی فروشگاه را شروع کنید</h2>
        <p>اطلاعات، ارسال و شرایط مرجوعی را در یک مسیر آرام کامل کنید.</p>
        <Link className={styles.primary} href="/seller/store/setup">
          شروع راه‌اندازی
        </Link>
      </div>
    );
  }

  const published = state.store.status === "PUBLISHED";
  return (
    <div className={styles.nextAction}>
      <h2>{published ? "فروشگاه منتشرشده است" : "پیش‌نویس فروشگاه ذخیره شده است"}</h2>
      <p>
        {published
          ? "اطلاعات فروشگاه را مرور یا ویرایش کنید."
          : "برای انتشار، اطلاعات باقی‌مانده را کامل کنید."}
      </p>
      <Link className={styles.primary} href="/seller/store/setup">
        {published ? "ویرایش فروشگاه" : "ادامه راه‌اندازی"}
      </Link>
      {published && state.store.slug ? (
        <Link className={styles.secondary} href={`/s/${state.store.slug}`}>
          دیدن فروشگاه
        </Link>
      ) : null}
    </div>
  );
}
