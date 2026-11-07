"use client";

import {
  storeDraftContract,
  storePreviewContract,
  type StoreDraft,
  type StorePreview,
} from "@sevo/contracts/store/v1";
import Link from "next/link";
import { useEffect, useState } from "react";

import styles from "../(workspace)/workspace-page.module.css";

type StoreState =
  | { kind: "LOADING" }
  | { kind: "EMPTY" }
  | {
      kind: "READY";
      store: StoreDraft;
      readiness?: StorePreview["publicationReadiness"];
    }
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
        try {
          const previewResponse = await fetch("/api/store/seller/store/preview", {
            cache: "no-store",
          });
          const preview = storePreviewContract.safeParse(await previewResponse.json());
          if (previewResponse.ok && preview.success) {
            return {
              kind: "READY",
              store: preview.data.store,
              readiness: preview.data.publicationReadiness,
            } as const;
          }
        } catch {
          // The saved draft remains usable even if readiness cannot be loaded.
        }
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
  const labels: Record<
    StorePreview["publicationReadiness"]["missingFields"][number],
    string
  > = {
    NAME: "نام فروشگاه",
    SLUG: "شناسه لینک",
    BIO: "معرفی کوتاه",
    SHIPPING_METHOD: "روش ارسال فعال",
    RETURN_POLICY: "سیاست مرجوعی",
    SETTLEMENT_DESTINATION: "مقصد تسویه",
  };
  const missing = state.readiness?.missingFields.map((field) => labels[field]);
  return (
    <div className={styles.nextAction}>
      <h2>{published ? "فروشگاه منتشرشده است" : "پیش‌نویس فروشگاه ذخیره شده است"}</h2>
      <p>
        {published
          ? "اطلاعات فروشگاه را مرور یا ویرایش کنید."
          : "برای انتشار، اطلاعات باقی‌مانده را کامل کنید."}
      </p>
      {!published &&
        (missing ? (
          <p>
            {missing.length
              ? `برای انتشار هنوز لازم است: ${missing.join("، ")}.`
              : "اطلاعات لازم برای انتشار آزمایشی کامل است."}
          </p>
        ) : (
          <p>وضعیت آمادگی انتشار دریافت نشد. دوباره تلاش کنید.</p>
        ))}
      {state.store.settlementDestination?.status === "TEST_VERIFIED" ? (
        <p>تسویه آزمایشی است؛ فروش و پرداخت واقعی فعال نیست.</p>
      ) : null}
      <Link className={styles.primary} href="/seller/store/setup">
        {published ? "ویرایش فروشگاه" : "ادامه راه‌اندازی"}
      </Link>
      <nav className={styles.settingsLinks} aria-label="تنظیمات فروشگاه">
        <Link className={styles.secondary} href="/seller/store/profile">
          معرفی
        </Link>
        <Link className={styles.secondary} href="/seller/store/shipping">
          ارسال
        </Link>
        <Link className={styles.secondary} href="/seller/store/returns">
          مرجوعی
        </Link>
        <Link className={styles.secondary} href="/seller/store/appearance">
          ظاهر
        </Link>
      </nav>
      {published && state.store.slug ? (
        <Link className={styles.secondary} href={`/s/${state.store.slug}`}>
          دیدن فروشگاه
        </Link>
      ) : null}
    </div>
  );
}
