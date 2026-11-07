"use client";

import { storeDraftContract } from "@sevo/contracts/store/v1";
import { sellerProductListContract } from "@sevo/contracts/product/v1";
import Link from "next/link";
import { useEffect, useState } from "react";
import { guideProgress } from "./seller-home-progress";
import styles from "./workspace-page.module.css";

type Progress = { step: 1 | 2 | 3 };
export function SellerHomeGuide() {
  const [progress, setProgress] = useState<Progress | null>(null);
  const [failed, setFailed] = useState(false);
  const [slug, setSlug] = useState<string | null>(null);
  const [open, setOpen] = useState<boolean | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const storeResponse = await fetch("/api/store/seller/store/draft", {
          cache: "no-store",
          signal: controller.signal,
        });
        const store =
          storeResponse.status === 404
            ? null
            : storeDraftContract.parse(await storeResponse.json());
        if (!storeResponse.ok && storeResponse.status !== 404) throw new Error();
        let hasProduct = false;
        if (store?.status === "PUBLISHED") {
          setSlug(store.slug);
          let cursor: string | null = null;
          do {
            const query = new URLSearchParams({ limit: "50" });
            if (cursor) query.set("cursor", cursor);
            const productsResponse = await fetch(
              `/api/store/seller/products?${query}`,
              {
                cache: "no-store",
                signal: controller.signal,
              },
            );
            if (!productsResponse.ok) throw new Error();
            const page = sellerProductListContract.parse(await productsResponse.json());
            // Creating the editor's empty draft does not add a product. A named
            // saved draft or a product that has been published does.
            hasProduct = page.items.some(
              (product) => product.name !== null || product.publicationVersion > 0,
            );
            cursor = page.nextCursor;
          } while (!hasProduct && cursor);
        }
        const step = guideProgress(store?.status === "PUBLISHED", hasProduct);
        setProgress({ step });
        setOpen(step !== 3);
      } catch {
        if (!controller.signal.aborted) setFailed(true);
      }
    }
    void load();
    return () => controller.abort();
  }, []);
  if (failed)
    return (
      <div className={styles.guide}>
        {slug && (
          <Link className={styles.secondary} href={`/s/${slug}`}>
            پیش‌نمایش خریدار
          </Link>
        )}
        <p role="alert">وضعیت راهنمای آغاز دریافت نشد. صفحه را دوباره بررسی کنید.</p>
      </div>
    );
  if (!progress)
    return (
      <div className={styles.guide}>
        {slug && (
          <Link className={styles.secondary} href={`/s/${slug}`}>
            پیش‌نمایش خریدار
          </Link>
        )}
        <p role="status">در حال بررسی مسیر آغاز…</p>
      </div>
    );
  const { step } = progress;
  return (
    <section className={styles.guide} aria-labelledby="guide-title">
      <div className={styles.guideHeader}>
        <h2 id="guide-title">مسیر آغاز</h2>
        <button
          className={styles.secondaryButton}
          type="button"
          aria-expanded={!!open}
          aria-controls="guide-steps"
          onClick={() => setOpen(!open)}
        >
          {open ? "بستن راهنما" : "دیدن راهنمای آغاز"}
        </button>
      </div>
      {slug && (
        <Link className={styles.secondary} href={`/s/${slug}`}>
          پیش‌نمایش خریدار
        </Link>
      )}
      <div id="guide-steps" hidden={!open} className={styles.guideSplit}>
        <ol>
          <li>درخواست فروشندگی تأیید شد · انجام شد</li>
          <li>راه‌اندازی و انتشار فروشگاه · {step > 1 ? "انجام شد" : "قدم بعدی"}</li>
          <li>
            افزودن اولین کالا ·{" "}
            {step === 3 ? "انجام شد" : step === 2 ? "قدم بعدی" : "پس از انتشار"}
          </li>
        </ol>
        <div>
          <h3>
            {step === 1
              ? "فروشگاه را منتشر کنید"
              : step === 2
                ? "اولین کالا را اضافه کنید"
                : "راه‌اندازی کامل شد"}
          </h3>
          <p>
            {step === 1
              ? "اطلاعات فروشگاه، ارسال و مرجوعی را کامل کنید."
              : step === 2
                ? "کالای خود را بسازید و برای فروش آماده کنید."
                : "می‌توانید فروشگاه و کالاهایتان را مدیریت کنید."}
          </p>
          {step < 3 && (
            <Link
              className={styles.primary}
              href={step === 1 ? "/seller/store/setup" : "/seller/products/new"}
            >
              {step === 1 ? "ادامه راه‌اندازی" : "افزودن کالا"}
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}
