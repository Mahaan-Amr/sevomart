import Link from "next/link";
import type { PublicStore } from "@sevo/contracts/store/v1";
import type {
  PublicProductSummary,
  PublicSimpleProductSummary,
} from "@sevo/contracts/product/v1";
import type { CSSProperties, ReactNode } from "react";

import { formatIrrAsToman } from "../../../lib/format-money";
import { newConversationHref } from "../../../lib/conversation-navigation";
import styles from "./storefront.module.css";
import { StoreFollowControl } from "./store-follow-control";

export function StorefrontPageFrame({ children }: { children: ReactNode }) {
  return (
    <>
      <a className={styles.skipLink} href="#storefront-content">
        رفتن به محتوای فروشگاه
      </a>
      <main className={styles.page} id="storefront-content" tabIndex={-1}>
        {children}
      </main>
    </>
  );
}

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

export function LoadingStorefront() {
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

export function ErrorStorefront({ retryHref }: { retryHref: string }) {
  return (
    <StorefrontFrame>
      <section className={styles.errorState} role="alert">
        <span className={styles.errorMark} aria-hidden="true">
          !
        </span>
        <h1>فروشگاه باز نشد</h1>
        <p>مشکلی از سمت ما پیش آمده است. کمی بعد دوباره تلاش کنید.</p>
        <a className={styles.retry} href={retryHref}>
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

function TrustDetails({ store }: { store: PublicStore }) {
  return (
    <section className={styles.trust} id="trust" aria-labelledby="trust-title">
      <div className={styles.trustHeading}>
        <p className={styles.eyebrow}>اطلاعات خرید</p>
        <h2 id="trust-title">پیش از سفارش بدانید</h2>
      </div>
      <div className={styles.trustItem}>
        <span>روش ارسال</span>
        <strong>{store.shippingMethods.map(({ label }) => label).join("، ")}</strong>
        <p>زمان دقیق ارسال هنگام ثبت سفارش مشخص می‌شود.</p>
      </div>
      <div className={styles.trustItem}>
        <span>مرجوعی</span>
        <strong>{store.returnPolicy}</strong>
        <p>این سیاست را فروشنده اعلام کرده است.</p>
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

export function ReadyStorefront({
  store,
  products = [],
  autoFollow = false,
}: {
  store: PublicStore;
  products?: Array<PublicSimpleProductSummary | PublicProductSummary>;
  autoFollow?: boolean;
}) {
  const identityStyle = { "--store-accent": store.themeColor } as CSSProperties;
  const monogram = Array.from(store.name.trim())[0] ?? "س";

  return (
    <StorefrontFrame>
      <header className={styles.identity} style={identityStyle}>
        <div className={styles.cover} aria-hidden="true">
          {store.cover ? (
            <img
              className={styles.coverImage}
              src={store.cover.url.replace(/^\/v1/, "/api/store")}
              alt=""
            />
          ) : null}
        </div>
        <div className={styles.identityBody}>
          <div className={styles.logo}>
            {store.logo ? (
              <img
                className={styles.logoImage}
                src={store.logo.url.replace(/^\/v1/, "/api/store")}
                alt={`نشان ${store.name}`}
              />
            ) : (
              <span aria-hidden="true">{monogram}</span>
            )}
          </div>
          <div className={styles.identityText}>
            <h1>{store.name}</h1>
            <p>{store.bio}</p>
          </div>
        </div>
        {store.followerCount ? (
          <StoreFollowControl
            storeId={store.id}
            slug={store.slug}
            initialCount={store.followerCount}
            initialViewer={store.viewer}
            autoFollow={autoFollow}
          />
        ) : null}
        <Link
          className={styles.conversation}
          href={newConversationHref(
            { kind: "STORE", storeId: store.id },
            `/s/${store.slug}`,
          )}
        >
          گفت‌وگو با فروشگاه
        </Link>
      </header>
      {products.length === 0 ? (
        <section className={styles.emptyState} aria-labelledby="empty-title">
          <span className={styles.emptyMark} aria-hidden="true">
            ✦
          </span>
          <h2 id="empty-title">هنوز کالایی منتشر نشده</h2>
          <p>فروشنده در حال آماده‌کردن اولین کالاهاست.</p>
        </section>
      ) : (
        <section className={styles.products} aria-labelledby="products-title">
          <h2 id="products-title">کالاهای فروشگاه</h2>
          <div className={styles.productList}>
            {products.map((product) => (
              <Link
                className={styles.product}
                href={`/s/${store.slug}/products/${product.productId}`}
                key={product.productId}
              >
                <img src={`/api/store/media/${product.image.id}`} alt={product.name} />
                <span>
                  <strong>{product.name}</strong>
                  <small>{formatSummaryPrice(product)}</small>
                  <em>{product.availability === "AVAILABLE" ? "موجود" : "ناموجود"}</em>
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}
      <TrustDetails store={store} />
    </StorefrontFrame>
  );
}

function formatSummaryPrice(
  product: PublicSimpleProductSummary | PublicProductSummary,
) {
  if (!("priceRange" in product)) return formatIrrAsToman(product.price.amount);
  const { minimum, maximum } = product.priceRange;
  return minimum.amount === maximum.amount
    ? formatIrrAsToman(minimum.amount)
    : `از ${formatIrrAsToman(minimum.amount)}`;
}
