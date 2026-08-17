import Link from "next/link";
import { notFound } from "next/navigation";
import type { CSSProperties, ReactNode } from "react";
import { publicStoreContract, type PublicStore } from "@sevo/contracts/store/v1";

import { getStorefrontFixture, type StorefrontFixture } from "./storefront-fixtures";
import styles from "./storefront.module.css";

function SevoBadge() {
  return (
    <footer className={styles.footer}>
      <Link href="/" aria-label="رفتن به صفحه اصلی سوو">
        <span aria-hidden="true">سوو</span>
        <span>ساخته‌شده با سوو</span>
      </Link>
    </footer>
  );
}

function StorefrontFrame({ children }: { children: ReactNode }) {
  return (
    <article className={styles.storefront}>
      {children}
      <SevoBadge />
    </article>
  );
}

function LoadingStorefront() {
  return (
    <StorefrontFrame>
      <section className={styles.loading} role="status" aria-busy="true">
        <span className={styles.loadingMark} aria-hidden="true">
          س
        </span>
        <h1>در حال آماده‌کردن فروشگاه</h1>
        <p>در حال دریافت اطلاعات این فروشگاه هستیم.</p>
        <div className={styles.skeleton} aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      </section>
      <section className={styles.trustUnavailable} aria-label="اطلاعات اعتماد">
        <strong>اطلاعات خرید در حال دریافت است</strong>
        <p>پیش از سفارش، روش ارسال، مرجوعی و پرداخت اینجا نمایش داده می‌شود.</p>
      </section>
    </StorefrontFrame>
  );
}

function ErrorStorefront() {
  return (
    <StorefrontFrame>
      <section className={styles.errorState} role="alert">
        <span className={styles.errorMark} aria-hidden="true">
          !
        </span>
        <h1>فروشگاه باز نشد</h1>
        <p>مشکلی از سمت ما پیش آمده است. کمی بعد دوباره تلاش کنید.</p>
        <a className={styles.retry} href="/s/fixture-error?retry=1">
          دوباره تلاش کنید
        </a>
      </section>
      <section className={styles.trustUnavailable} aria-label="اطلاعات اعتماد">
        <strong>اطلاعات اعتماد فعلاً در دسترس نیست</strong>
        <p>پیش از سفارش، دوباره این صفحه را بررسی کنید.</p>
      </section>
    </StorefrontFrame>
  );
}

type ReadyFixture = Extract<StorefrontFixture, { state: "ready" }>;
type ReadyStorefrontModel = ReadyFixture & {
  logoUrl?: string;
  coverUrl?: string;
};

function TrustDetails({ fixture }: { fixture: ReadyStorefrontModel }) {
  return (
    <section className={styles.trust} id="trust" aria-labelledby="trust-title">
      <div className={styles.trustHeading}>
        <p className={styles.eyebrow}>اطلاعات خرید</p>
        <h2 id="trust-title">پیش از سفارش بدانید</h2>
      </div>
      <div className={styles.trustItem}>
        <span>روش ارسال</span>
        <strong>{fixture.shipping}</strong>
        <p>زمان دقیق ارسال هنگام ثبت سفارش مشخص می‌شود.</p>
      </div>
      <div className={styles.trustItem}>
        <span>مرجوعی</span>
        <strong>{fixture.returns}</strong>
        <p>شرایط کامل فروشنده پیش از ثبت سفارش نمایش داده می‌شود.</p>
      </div>
      <div className={styles.trustItem}>
        <span>روش پرداخت</span>
        <strong>تسویه مستقیم</strong>
        <p>
          مقصد تسویه «تأیید آزمایشی» دارد؛ این وضعیت تأیید واقعی یا تضمین بازپرداخت
          نیست.
        </p>
      </div>
    </section>
  );
}

function ReadyStorefront({ fixture }: { fixture: ReadyStorefrontModel }) {
  const identityStyle = {
    "--store-accent": fixture.identity.accent,
    "--cover-start": fixture.identity.coverStart,
    "--cover-end": fixture.identity.coverEnd,
  } as CSSProperties;

  return (
    <StorefrontFrame>
      <header className={styles.identity} style={identityStyle}>
        <div className={styles.cover} aria-hidden="true">
          {fixture.coverUrl ? (
            <img className={styles.coverImage} src={fixture.coverUrl} alt="" />
          ) : null}
        </div>
        <div className={styles.identityBody}>
          <div className={styles.logo} aria-hidden="true">
            {fixture.logoUrl ? (
              <img className={styles.logoImage} src={fixture.logoUrl} alt="" />
            ) : (
              fixture.identity.logoMonogram
            )}
          </div>
          <div className={styles.identityText}>
            <h1>{fixture.identity.name}</h1>
            <p>{fixture.identity.description}</p>
          </div>
        </div>
      </header>

      <section className={styles.emptyState} aria-labelledby="empty-title">
        <span className={styles.emptyMark} aria-hidden="true">
          ✦
        </span>
        <h2 id="empty-title">هنوز کالایی منتشر نشده</h2>
        <p>فروشنده در حال آماده‌کردن اولین کالاهاست.</p>
      </section>

      <TrustDetails fixture={fixture} />
    </StorefrontFrame>
  );
}

export default async function StorefrontPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ retry?: string | string[] }>;
}) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const fixtureSlug =
    slug === "fixture-error" && query.retry === "1" ? "fixture-short" : slug;
  const fixture =
    getStorefrontFixture(fixtureSlug) ?? (await getPublishedStorefront(fixtureSlug));
  if (!fixture) notFound();

  return (
    <>
      <a className={styles.skipLink} href="#storefront-content">
        رفتن به محتوای فروشگاه
      </a>
      <main className={styles.page} id="storefront-content" tabIndex={-1}>
        {fixture.state === "loading" ? (
          <LoadingStorefront />
        ) : fixture.state === "error" ? (
          <ErrorStorefront />
        ) : (
          <ReadyStorefront fixture={fixture} />
        )}
      </main>
    </>
  );
}

async function getPublishedStorefront(
  slug: string,
): Promise<StorefrontFixture | ReadyStorefrontModel | undefined> {
  const response = await fetch(
    `${process.env.API_BASE_URL ?? "http://127.0.0.1:3001"}/v1/stores/${encodeURIComponent(slug)}`,
    { cache: "no-store" },
  );
  if (response.status === 404) return undefined;
  if (!response.ok) return { state: "error" };
  const parsed = publicStoreContract.safeParse(await response.json());
  if (!parsed.success) return { state: "error" };
  return publicStoreToModel(parsed.data);
}

function publicStoreToModel(store: PublicStore): ReadyStorefrontModel {
  return {
    state: "ready",
    identity: {
      name: store.name,
      description: store.bio,
      logoMonogram: store.name.trim().slice(0, 1),
      accent: store.themeColor,
      coverStart: "#F6E3E9",
      coverEnd: "#EAD5DB",
    },
    shipping: store.shippingMethods.map((method) => method.label).join("، "),
    returns: store.returnPolicy,
    logoUrl: store.logo ? store.logo.url.replace(/^\/v1/, "/api/store") : undefined,
    coverUrl: store.cover ? store.cover.url.replace(/^\/v1/, "/api/store") : undefined,
  };
}
