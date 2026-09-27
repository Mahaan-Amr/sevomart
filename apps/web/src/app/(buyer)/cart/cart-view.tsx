"use client";

import { cartV2Contract, type CartV2 } from "@sevo/contracts/orders/v2";
import type { CartReviewChange } from "@sevo/contracts/orders/v1";
import { useEffect, useState } from "react";

import { formatIrrAsToman } from "../../../lib/format-money";
import styles from "./cart.module.css";

type MergeConflict = {
  guestCart: CartV2;
  quantities: Array<{
    variantId: string;
    guestQuantity: number;
    buyerQuantity: number;
  }>;
  lineLimitExceeded: boolean;
};

export function CartView() {
  const [cart, setCart] = useState<CartV2>();
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [attached, setAttached] = useState(false);
  const [mergeConflict, setMergeConflict] = useState<MergeConflict>();

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    setLoading(true);
    try {
      const response = await fetch("/api/cart/v2", { cache: "no-store" });
      const body = (await response.json()) as { cart?: unknown };
      const parsed = cartV2Contract.safeParse(body.cart);
      setCart(parsed.success ? parsed.data : undefined);
    } catch {
      setMessage("سبد بارگیری نشد. دوباره تلاش کنید.");
    } finally {
      setLoading(false);
    }
  }

  async function changeItem(variantId: string, quantity: number) {
    if (!cart) return;
    setPending(true);
    try {
      const removing = quantity === 0;
      const response = await fetch(`/api/cart/v2/items/${variantId}`, {
        method: removing ? "DELETE" : "PUT",
        headers: {
          "content-type": "application/json",
          "idempotency-key": crypto.randomUUID(),
        },
        body: JSON.stringify(
          removing
            ? { expectedRevision: cart.revision }
            : { variantId, quantity, expectedRevision: cart.revision },
        ),
      });
      const body = await response.json();
      const parsed = cartV2Contract.safeParse(body);
      if (response.ok && parsed.success) {
        setCart(parsed.data);
        setAttached(false);
        setMessage(removing ? "کالا از سبد حذف شد." : "تعداد به‌روز شد.");
      } else {
        const current = cartV2Contract.safeParse(body.currentCart);
        if (current.success) setCart(current.data);
        setMessage(body.message ?? "سبد تغییر کرده است. دوباره بررسی کنید.");
      }
    } catch {
      setMessage("سبد به‌روز نشد. دوباره تلاش کنید.");
    } finally {
      setPending(false);
    }
  }

  async function confirmReview() {
    if (!cart) return;
    setPending(true);
    try {
      const response = await fetch("/api/cart/v2/review", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": crypto.randomUUID(),
        },
        body: JSON.stringify({ expectedRevision: cart.revision, confirmed: true }),
      });
      const parsed = cartV2Contract.safeParse(await response.json());
      if (response.ok && parsed.success) {
        setCart(parsed.data);
        setMessage("تغییرهای سبد تأیید شد.");
      } else {
        setMessage("سبد دوباره تغییر کرده است. نسخه تازه را ببینید.");
        await load();
      }
    } finally {
      setPending(false);
    }
  }

  async function continueCheckout() {
    setPending(true);
    setMessage("");
    try {
      const response = await fetch("/api/cart/v2/attach", {
        method: "POST",
        headers: { "idempotency-key": crypto.randomUUID() },
        body: "{}",
      });
      if (response.status === 401) {
        window.location.assign(
          "/login?returnTo=%2Fcart%3Fcontinue%3D1&cancelTo=%2Fcart",
        );
        return;
      }
      const body = await response.json();
      const parsed = cartV2Contract.safeParse(body.cart);
      if (!response.ok || !parsed.success) {
        setMessage(body.message ?? "سبدها ترکیب نشدند. تعدادها را بررسی کنید.");
        return;
      }
      setCart(parsed.data);
      const guest = cartV2Contract.safeParse(body.guestCart);
      if (guest.success && body.conflicts) {
        setMergeConflict({ guestCart: guest.data, ...body.conflicts });
        setMessage(
          "هر دو سبد حفظ شده‌اند. تعدادهای ناسازگار را در سبد حساب کم کنید و دوباره ادامه دهید.",
        );
        return;
      }
      setMergeConflict(undefined);
      setAttached(true);
    } catch {
      setMessage("ادامه خرید آماده نشد. دوباره تلاش کنید.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className={styles.page}>
      <section className={styles.panel} aria-labelledby="cart-title">
        <header className={styles.header}>
          <a href="/" className={styles.brand}>
            سوو
          </a>
          <h1 id="cart-title">سبد شما</h1>
          <p>کالاهای انتخاب‌شده از فروشگاه‌های مختلف</p>
        </header>
        {loading ? <p role="status">در حال آماده‌کردن سبد…</p> : null}
        {!loading && !cart?.stores.length ? (
          <div className={styles.emptyState}>
            <p>سبد شما خالی است. کالایی را انتخاب کنید.</p>
            <a href="/">دیدن کالاها</a>
          </div>
        ) : null}
        {cart?.stores.map((store) => (
          <section
            className={styles.storeSection}
            aria-label={`فروشگاه ${store.name}`}
            key={store.storeId}
          >
            <div className={styles.storeHeading}>
              <h2>{store.name}</h2>
              <strong>{formatIrrAsToman(store.subtotal.amount)}</strong>
            </div>
            <ul className={styles.items} aria-label={`کالاهای ${store.name}`}>
              {store.items.map((item) => (
                <li className={styles.item} key={item.variantId}>
                  <img
                    className={styles.itemImage}
                    src={`/api/store/media/${item.image.id}`}
                    alt=""
                    width={88}
                    height={88}
                  />
                  <div className={styles.itemContent}>
                    <b>{item.name}</b>
                    {store.slug ? (
                      <a
                        className={styles.productDetailLink}
                        href={`/s/${encodeURIComponent(store.slug)}/products/${encodeURIComponent(item.productId)}`}
                      >
                        دیدن جزئیات کالا
                      </a>
                    ) : null}
                    <span className={styles.unitPrice}>
                      هر عدد {formatIrrAsToman(item.unitPrice.amount)}
                    </span>
                    {item.availability !== "AVAILABLE" ? (
                      <em className={styles.availability}>
                        این کالا با تعداد انتخاب‌شده در دسترس نیست.
                      </em>
                    ) : null}
                    <ItemReviewChanges
                      changes={cart.reviewChanges
                        .filter(
                          ({ storeId, change }) =>
                            storeId === store.storeId &&
                            "variantId" in change &&
                            change.variantId === item.variantId,
                        )
                        .map(({ change }) => change)}
                    />
                    <div className={styles.itemFooter}>
                      <div
                        className={styles.quantityControl}
                        role="group"
                        aria-label={`تعداد ${item.name}`}
                      >
                        <button
                          type="button"
                          aria-label={`کم‌کردن تعداد ${item.name}`}
                          disabled={pending || item.quantity <= 1}
                          onClick={() => changeItem(item.variantId, item.quantity - 1)}
                        >
                          <span className={styles.minusIcon} aria-hidden="true" />
                        </button>
                        <span className={styles.quantityValue}>
                          تعداد {item.quantity.toLocaleString("fa-IR")}
                        </span>
                        <button
                          type="button"
                          aria-label={`بیشترکردن تعداد ${item.name}`}
                          disabled={pending || item.quantity >= 99}
                          onClick={() => changeItem(item.variantId, item.quantity + 1)}
                        >
                          +
                        </button>
                      </div>
                      <button
                        type="button"
                        className={styles.removeAction}
                        aria-label={`حذف ${item.name}`}
                        disabled={pending}
                        onClick={() => changeItem(item.variantId, 0)}
                      >
                        حذف
                      </button>
                      <strong className={styles.lineTotal}>
                        {formatIrrAsToman(item.unitPrice.amount * item.quantity)}
                      </strong>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
        {cart?.stores.length ? (
          <>
            {mergeConflict ? (
              <section className={styles.conflict} aria-labelledby="merge-title">
                <h2 id="merge-title">ترکیب دو سبد نیاز به بررسی دارد</h2>
                <p>
                  سبد پیش از ورود و سبد حساب شما حفظ شده‌اند. کالاهای سبد حساب را در
                  بالا کم کنید، سپس دوباره ادامه دهید.
                </p>
                {mergeConflict.quantities.length ? (
                  <ul className={styles.quantityComparison}>
                    {mergeConflict.quantities.map((item) => {
                      const product = mergeConflict.guestCart.stores
                        .flatMap((store) => store.items)
                        .find((candidate) => candidate.variantId === item.variantId);
                      return (
                        <li key={item.variantId}>
                          <strong>{product?.name ?? "کالا"}</strong>
                          <span>
                            سبد پیش از ورود:{" "}
                            {item.guestQuantity.toLocaleString("fa-IR")} · سبد حساب:{" "}
                            {item.buyerQuantity.toLocaleString("fa-IR")} · حداکثر: ۹۹
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
                {mergeConflict.lineLimitExceeded ? (
                  <p>
                    مجموع دو سبد از ۱۰۰ گونه کالا بیشتر می‌شود. چند کالا را از سبد حساب
                    بردارید.
                  </p>
                ) : null}
                <button type="button" disabled={pending} onClick={continueCheckout}>
                  بررسی دوباره و ترکیب سبدها
                </button>
              </section>
            ) : null}
            <section className={styles.summary} aria-label="جمع سبد">
              <div className={styles.subtotal}>
                <span>جمع کالاها</span>
                <strong>{formatIrrAsToman(cart.subtotal.amount)}</strong>
              </div>
              <p>هزینهٔ ارسال هر فروشگاه و مبلغ نهایی در قدم بعد نشان داده می‌شود.</p>
            </section>
            {cart.reviewRequired ? (
              <section className={styles.review} aria-labelledby="review-title">
                <h2 id="review-title">سبد تغییر کرده است</h2>
                {cart.reviewChanges.map(({ storeId, change }, index) => (
                  <p key={`${storeId}-${change.kind}-${index}`}>
                    <strong>
                      {cart.stores.find((store) => store.storeId === storeId)?.name}
                      :{" "}
                    </strong>
                    {reviewDescription(change)}
                  </p>
                ))}
                <button type="button" disabled={pending} onClick={confirmReview}>
                  تغییرها را دیدم
                </button>
              </section>
            ) : null}
            {!cart.reviewRequired && !attached && !mergeConflict ? (
              <button
                className={styles.primaryAction}
                type="button"
                disabled={
                  pending ||
                  cart.stores.some((store) =>
                    store.items.some((item) => item.availability !== "AVAILABLE"),
                  )
                }
                onClick={continueCheckout}
              >
                {pending ? "در حال آماده‌سازی…" : "ادامه برای ثبت سفارش"}
              </button>
            ) : null}
            {!cart.reviewRequired && attached ? (
              <a className={styles.primaryLink} href="/checkout/delivery">
                ادامه به تحویل سفارش
              </a>
            ) : null}
          </>
        ) : null}
        {message ? <p role="status">{message}</p> : null}
      </section>
    </main>
  );
}

function reviewDescription(change: CartReviewChange) {
  if (change.kind === "PRICE_CHANGED")
    return `قیمت از ${formatIrrAsToman(change.previousUnitPrice.amount)} به ${formatIrrAsToman(change.currentUnitPrice.amount)} تغییر کرده است.`;
  if (change.kind === "POLICY_CHANGED")
    return `شرایط مرجوعی: ${change.currentPolicyText}`;
  if (change.kind === "SHIPPING_METHOD_CHANGED")
    return "روش‌های ارسال تغییر کرده است. در ادامه خرید بررسی کنید.";
  if (change.kind === "PRODUCT_CHANGED") return "اطلاعات کالا تغییر کرده است.";
  return "کالا با تعداد انتخاب‌شده در دسترس نیست.";
}

function ItemReviewChanges({ changes }: { changes: CartReviewChange[] }) {
  if (!changes.length) return null;
  return (
    <ul className={styles.itemChanges}>
      {changes.map((change) => (
        <li key={change.kind}>{reviewDescription(change)}</li>
      ))}
    </ul>
  );
}
