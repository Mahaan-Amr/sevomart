import { publicStoreContract, storeDraftContract } from "@sevo/contracts/store/v1";
import { sellerProductListContract } from "@sevo/contracts/product/v1";
import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { readSellerWorkspaceAccess } from "../../../../lib/seller-workspace-access";
import { firstParameter } from "../../../../lib/navigation";
import { nextProfilePage, productPageQuery } from "./profile-pagination";
import styles from "./profile.module.css";

const API_BASE_URL = process.env.API_BASE_URL ?? "http://127.0.0.1:3001";

export default async function SellerProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string | string[] }>;
}) {
  const cursor = firstParameter((await searchParams).cursor);
  const cookieHeader = (await cookies()).toString();
  const access = await readSellerWorkspaceAccess(cookieHeader);
  if (
    access.kind === "SIGNED_OUT" ||
    access.kind === "APPLICANT" ||
    access.kind === "INACTIVE"
  )
    redirect("/");
  if (access.kind !== "ACTIVE")
    return (
      <p role="alert">پروفایل فروشگاه فعلاً در دسترس نیست. کمی بعد دوباره تلاش کنید.</p>
    );

  const headers = { cookie: cookieHeader };
  try {
    const [storeResponse, productsResponse] = await Promise.all([
      fetch(`${API_BASE_URL}/v1/seller/store/draft`, { headers, cache: "no-store" }),
      fetch(`${API_BASE_URL}/v1/seller/products?${productPageQuery(cursor)}`, {
        headers,
        cache: "no-store",
      }),
    ]);
    if (storeResponse.status === 404) {
      return (
        <div className={styles.profile}>
          <h1>پروفایل فروشگاه</h1>
          <p>برای نمایش فروشگاه، ابتدا راه‌اندازی را کامل کنید.</p>
          <Link className={styles.primary} href="/seller/store/setup">
            شروع راه‌اندازی
          </Link>
          <Link className={styles.secondary} href="/seller">
            فضای فروشنده
          </Link>
        </div>
      );
    }
    if (!storeResponse.ok) throw new Error("store unavailable");
    const store = storeDraftContract.parse(await storeResponse.json());
    const productPage = productsResponse.ok
      ? sellerProductListContract.safeParse(await productsResponse.json())
      : null;
    const products = productPage?.success
      ? productPage.data.items.filter((product) => product.name)
      : [];
    const published = store.status === "PUBLISHED";
    let publicStore: ReturnType<typeof publicStoreContract.parse> | undefined;
    if (published) {
      try {
        const response = await fetch(
          `${API_BASE_URL}/v1/stores/${encodeURIComponent(store.slug)}`,
          { headers, cache: "no-store" },
        );
        if (response.ok) {
          const parsed = publicStoreContract.safeParse(await response.json());
          if (parsed.success) publicStore = parsed.data;
        }
      } catch {
        // A failed public summary should not prevent access to the seller's draft.
      }
    }
    return (
      <div className={styles.profile}>
        <header className={styles.header}>
          <div className={styles.topline}>
            <h1>پروفایل فروشگاه</h1>
          </div>
          <div className={styles.identity}>
            <div className={styles.avatar}>
              {store.logoMediaId ? (
                <img src={`/api/store/media/${store.logoMediaId}`} alt="" />
              ) : (
                <span aria-hidden="true">{Array.from(store.name ?? "سوو")[0]}</span>
              )}
            </div>
            <div className={styles.identityText}>
              <strong>{store.name ?? "فروشگاه شما"}</strong>
              {store.slug ? <span dir="ltr">@{store.slug}</span> : null}
              <span>{published ? "فروشگاه منتشر شده" : "در حال راه‌اندازی"}</span>
            </div>
          </div>
          {publicStore ? (
            <div className={styles.stats} aria-label="آمار فروشگاه">
              <span>
                <strong>
                  {new Intl.NumberFormat("fa-IR").format(
                    publicStore.activeProductCount,
                  )}
                </strong>{" "}
                کالای فعال
              </span>
              {publicStore.followerCount ? (
                <span>
                  <strong>
                    {new Intl.NumberFormat("fa-IR").format(
                      publicStore.followerCount.count,
                    )}
                  </strong>{" "}
                  دنبال‌کننده
                </span>
              ) : null}
              {publicStore.verifiedPurchases ? (
                <span>
                  <strong>
                    {new Intl.NumberFormat("fa-IR").format(
                      publicStore.verifiedPurchases.count,
                    )}
                  </strong>{" "}
                  خرید تأییدشده
                </span>
              ) : null}
            </div>
          ) : null}
          {store.bio ? (
            <p className={styles.bio}>{store.bio}</p>
          ) : (
            <p className={styles.bio}>معرفی کوتاهی برای فروشگاهتان بنویسید.</p>
          )}
          {productPage?.success && (cursor || productPage.data.nextCursor) ? (
            <nav aria-label="صفحه‌های کالا">
              {cursor ? (
                <Link className={styles.secondary} href="/profile">
                  بازگشت به کالاهای نخست
                </Link>
              ) : null}
              {productPage.data.nextCursor ? (
                <Link
                  className={styles.secondary}
                  href={nextProfilePage(productPage.data.nextCursor)!}
                >
                  دیدن کالاهای بیشتر
                </Link>
              ) : null}
            </nav>
          ) : null}
          <div className={styles.actions}>
            <Link className={styles.secondary} href="/seller/store/setup">
              {published ? "ویرایش فروشگاه" : "ادامه راه‌اندازی"}
            </Link>
            <Link className={styles.secondary} href="/seller">
              فضای فروشنده
            </Link>
            {published && store.slug ? (
              <Link className={styles.secondary} href={`/s/${store.slug}`}>
                دیدن فروشگاه
              </Link>
            ) : null}
          </div>
        </header>
        <section aria-labelledby="profile-products-title">
          <div className={styles.sectionHeading}>
            <h2 id="profile-products-title">کالاها</h2>
            <Link href="/seller/products">مدیریت کالاها</Link>
          </div>
          {!productPage?.success ? (
            <p role="alert">
              کالاها دریافت نشدند. برای بررسی دوباره به مدیریت کالاها بروید.
            </p>
          ) : products.length ? (
            <ul className={styles.grid}>
              {products.map((product) => (
                <li key={product.productId}>
                  <Link href={`/seller/products/${product.productId}/edit`}>
                    <span className={styles.tile}>
                      {product.primaryMediaId ? (
                        <img
                          src={`/api/store/media/${product.primaryMediaId}`}
                          alt=""
                        />
                      ) : (
                        <span aria-hidden="true">سوو</span>
                      )}
                    </span>
                    <span className={styles.productName}>{product.name}</span>
                    <small>
                      {product.state === "PUBLISHED"
                        ? "منتشرشده"
                        : product.state === "DRAFT"
                          ? "پیش‌نویس"
                          : "منتشر نشده"}
                    </small>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <div className={styles.empty}>
              <p>هنوز کالایی اضافه نکرده‌اید.</p>
              <Link className={styles.primary} href="/seller/products/new">
                افزودن اولین کالا
              </Link>
            </div>
          )}
        </section>
      </div>
    );
  } catch {
    return <p role="alert">پروفایل فروشگاه دریافت نشد. صفحه را دوباره باز کنید.</p>;
  }
}
