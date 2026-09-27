"use client";

import {
  cartContract,
  cartErrorContract,
  cartResolutionContract,
  type Cart,
  type CartConflict,
  type CartReviewChange,
} from "@sevo/contracts/orders/v1";
import { useEffect, useState } from "react";

import { formatIrrAsToman } from "../../../lib/format-money";
import styles from "./cart.module.css";

export function CartView() {
  const [cart, setCart] = useState<Cart>();
  const [conflict, setConflict] = useState<CartConflict>();
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [checkoutReady, setCheckoutReady] = useState(false);
  const subtotal =
    cart?.items.reduce(
      (total, item) => total + item.unitPrice.amount * item.quantity,
      0,
    ) ?? 0;

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    setLoading(true);
    try {
      const response = await fetch("/api/cart", { cache: "no-store" });
      const body = (await response.json()) as { cart?: unknown };
      const parsed = cartContract.safeParse(body.cart);
      if (parsed.success) {
        setCart(parsed.data);
        if (parsed.data.requiresResolution) await inspectAttachment();
      } else {
        setCart(undefined);
      }
    } catch {
      setMessage("سبد بارگیری نشد. دوباره تلاش کنید.");
    } finally {
      setLoading(false);
    }
  }

  async function inspectAttachment() {
    const response = await fetch("/api/cart/attach", {
      method: "POST",
      headers: { "idempotency-key": crypto.randomUUID() },
      body: "{}",
    });
    if (response.status === 401) return;
    const parsed = cartResolutionContract.safeParse(await response.json());
    if (parsed.success && parsed.data.status === "RESOLUTION_REQUIRED") {
      setConflict(parsed.data.conflict);
    }
  }

  async function continueCheckout() {
    setPending(true);
    setMessage("");
    try {
      const response = await fetch("/api/cart/attach", {
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
      const parsed = cartResolutionContract.safeParse(await response.json());
      if (parsed.success && parsed.data.status === "RESOLUTION_REQUIRED") {
        setConflict(parsed.data.conflict);
        return;
      }
      setCheckoutReady(true);
      setMessage("سبد به هویت سوو متصل شد و برای ادامه خرید آماده است.");
      await load();
    } catch {
      setMessage("ادامه خرید آماده نشد. دوباره تلاش کنید.");
    } finally {
      setPending(false);
    }
  }

  async function changeItem(variantId: string, quantity: number) {
    if (!cart) return;
    setPending(true);
    const removing = quantity === 0;
    const response = await fetch(`/api/cart/items/${variantId}`, {
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
    const parsed = cartContract.safeParse(body);
    if (response.ok && parsed.success) {
      setCart(parsed.data);
      setMessage(removing ? "کالا از سبد حذف شد." : "تعداد به‌روز شد.");
    } else {
      const conflict = cartErrorContract.safeParse(body);
      if (conflict.success && conflict.data.currentCart) {
        setCart(conflict.data.currentCart);
        setMessage("سبد در جای دیگری تغییر کرده است. نسخه تازه را بررسی کنید.");
      } else {
        setMessage("سبد به‌روز نشد. دوباره تلاش کنید.");
      }
    }
    setPending(false);
  }

  async function confirmReview() {
    if (!cart) return;
    setPending(true);
    const response = await fetch("/api/cart/review", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": crypto.randomUUID(),
      },
      body: JSON.stringify({ expectedRevision: cart.revision, confirmed: true }),
    });
    const parsed = cartContract.safeParse(await response.json());
    if (response.ok && parsed.success) {
      setCart(parsed.data);
      setMessage("تغییرهای سبد تأیید شد.");
    } else {
      setMessage("سبد دوباره تغییر کرده است. نسخه تازه را ببینید.");
      await load();
    }
    setPending(false);
  }

  async function resolve(decision: "MERGE" | "KEEP_GUEST" | "KEEP_BUYER") {
    if (!conflict) return;
    setPending(true);
    try {
      const response = await fetch("/api/cart/resolve", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": crypto.randomUUID(),
        },
        body: JSON.stringify({
          decision,
          guestRevision: conflict.guest.revision,
          buyerRevision: conflict.buyer.revision,
        }),
      });
      const parsed = cartResolutionContract.safeParse(await response.json());
      if (!response.ok || !parsed.success || parsed.data.status !== "ATTACHED") {
        setMessage("سبدها تغییر کرده‌اند؛ نسخه تازه را ببینید.");
        await load();
        return;
      }
      setConflict(undefined);
      setCart(parsed.data.cart);
      setMessage("انتخاب شما انجام شد و سبد آماده ادامه خرید است.");
    } finally {
      setPending(false);
    }
  }

  if (loading) {
    return (
      <main className={styles.page}>
        <section className={styles.panel} role="status">
          در حال آماده‌کردن سبد…
        </section>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <section className={styles.panel} aria-labelledby="cart-title">
        <header className={styles.header}>
          <a href="/" className={styles.brand}>
            سوو
          </a>
          <h1 id="cart-title">سبد شما</h1>
          {cart?.items.length ? (
            <p className={styles.store}>از فروشگاه {cart.store.name}</p>
          ) : null}
        </header>
        {!cart?.items.length ? (
          <div className={styles.emptyState}>
            <p>سبد شما خالی است. از یک فروشگاه کالایی انتخاب کنید.</p>
            <a href="/">دیدن کالاها</a>
          </div>
        ) : (
          <>
            <ul className={styles.items} aria-label="کالاهای سبد">
              {cart.items.map((item) => (
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
                    {cart.store.slug ? (
                      <a
                        className={styles.productDetailLink}
                        href={`/s/${encodeURIComponent(cart.store.slug)}/products/${encodeURIComponent(item.productId)}`}
                      >
                        دیدن جزئیات کالا
                      </a>
                    ) : null}
                    <span className={styles.unitPrice}>
                      هر عدد {formatIrrAsToman(item.unitPrice.amount)}
                    </span>
                    {item.availability !== "AVAILABLE" ? (
                      <em className={styles.availability}>
                        موجودی این مورد تغییر کرده است.
                      </em>
                    ) : null}
                    <ItemReviewChanges
                      changes={cart.reviewChanges.filter(
                        (change) =>
                          "variantId" in change && change.variantId === item.variantId,
                      )}
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
                          −
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
            <section className={styles.summary} aria-label="جمع سبد">
              <div className={styles.subtotal}>
                <span>جمع کالاها</span>
                <strong>{formatIrrAsToman(subtotal)}</strong>
              </div>
              <p>
                هزینه ارسال در قدم بعد مشخص می‌شود. مبلغ نهایی را پیش از ثبت سفارش
                می‌بینید.
              </p>
            </section>
            {cart.reviewRequired ? (
              <section className={styles.review} aria-labelledby="review-title">
                <h2 id="review-title">سبد تغییر کرده است</h2>
                {cart.reviewChanges
                  .filter((change) => change.kind === "POLICY_CHANGED")
                  .map((change) => (
                    <div key={change.kind}>
                      <strong>شرایط تازه مرجوعی</strong>
                      <p>{change.currentPolicyText}</p>
                    </div>
                  ))}
                {cart.reviewChanges
                  .filter((change) => change.kind === "SHIPPING_METHOD_CHANGED")
                  .map((change) => (
                    <div key={change.kind}>
                      <strong>روش‌های تازه ارسال</strong>
                      {change.currentMethods.length ? (
                        <ul>
                          {change.currentMethods.map((method) => (
                            <li key={`${method.label}-${method.estimatedDeliveryText}`}>
                              {method.label}، {formatIrrAsToman(method.fixedFee.amount)}
                              ، {method.estimatedDeliveryText}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p>اکنون روش ارسالی برای این فروشگاه ثبت نشده است.</p>
                      )}
                    </div>
                  ))}
                <p>تغییرهای بالا را دوباره ببینید و سپس تأیید کنید.</p>
                <button type="button" disabled={pending} onClick={confirmReview}>
                  تغییرها را دیدم
                </button>
              </section>
            ) : null}
            {checkoutReady ? (
              <a className={styles.primaryLink} href="/checkout/delivery">
                ادامه به تحویل سفارش
              </a>
            ) : conflict ? (
              <ConflictChoice conflict={conflict} pending={pending} resolve={resolve} />
            ) : !cart.reviewRequired ? (
              <button
                className={styles.primaryAction}
                type="button"
                onClick={continueCheckout}
                disabled={pending}
              >
                {pending ? "در حال آماده‌سازی…" : "ادامه برای ثبت سفارش"}
              </button>
            ) : null}
          </>
        )}
        {message ? <p role="status">{message}</p> : null}
      </section>
    </main>
  );
}

function ConflictChoice({
  conflict,
  pending,
  resolve,
}: {
  conflict: CartConflict;
  pending: boolean;
  resolve: (decision: "MERGE" | "KEEP_GUEST" | "KEEP_BUYER") => Promise<void>;
}) {
  return (
    <section className={styles.conflict} aria-labelledby="conflict-title">
      <h2 id="conflict-title">کدام سبد را ادامه می‌دهید؟</h2>
      <p>
        پیش از ورود سبد «{conflict.guest.storeName}» و در هویت سوو شما سبد «
        {conflict.buyer.storeName}» وجود دارد. تا انتخاب شما چیزی حذف نمی‌شود.
      </p>
      <p>
        سبد پیش از ورود {conflict.guest.itemCount.toLocaleString("fa-IR")} کالا و سبد
        هویت سوو شما {conflict.buyer.itemCount.toLocaleString("fa-IR")} کالا دارد.
      </p>
      {conflict.kind === "SAME_STORE" ? (
        <>
          <ul className={styles.quantityComparison}>
            {conflict.combinedQuantities.map((item) => (
              <li key={item.variantId}>
                <strong>{item.name}</strong>
                <span>
                  پیش از ورود: {item.guestQuantity.toLocaleString("fa-IR")}، هویت سوو
                  من: {item.buyerQuantity.toLocaleString("fa-IR")}، پس از ترکیب:{" "}
                  {item.mergedQuantity.toLocaleString("fa-IR")}
                </span>
              </li>
            ))}
          </ul>
          {conflict.mergeAllowed ? (
            <button type="button" disabled={pending} onClick={() => resolve("MERGE")}>
              ترکیب دو سبد
            </button>
          ) : (
            <p role="status">
              تعداد یکی از کالاها پس از ترکیب بیشتر از ۹۹ می‌شود. یکی از دو سبد را نگه
              دارید و سپس تعداد را تغییر دهید.
            </p>
          )}
        </>
      ) : null}
      <button
        className={styles.secondaryAction}
        type="button"
        disabled={pending}
        onClick={() => resolve("KEEP_GUEST")}
      >
        نگه‌داشتن سبد پیش از ورود
      </button>
      <button
        className={styles.secondaryAction}
        type="button"
        disabled={pending}
        onClick={() => resolve("KEEP_BUYER")}
      >
        نگه‌داشتن سبد هویت سوو من
      </button>
    </section>
  );
}

function ItemReviewChanges({ changes }: { changes: CartReviewChange[] }) {
  if (!changes.length) return null;
  return (
    <ul className={styles.itemChanges}>
      {changes.map((change) => (
        <li key={change.kind}>
          {change.kind === "PRICE_CHANGED"
            ? `قیمت از ${formatIrrAsToman(change.previousUnitPrice.amount)} به ${formatIrrAsToman(change.currentUnitPrice.amount)} تغییر کرده است.`
            : change.kind === "PRODUCT_CHANGED"
              ? "اطلاعات این کالا تغییر کرده است."
              : "این کالا دیگر با تعداد انتخاب‌شده در دسترس نیست."}
        </li>
      ))}
    </ul>
  );
}
