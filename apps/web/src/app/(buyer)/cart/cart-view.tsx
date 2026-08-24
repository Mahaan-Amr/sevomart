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
    return <main className={styles.page}>در حال آماده‌کردن سبد…</main>;
  }

  return (
    <main className={styles.page}>
      <section className={styles.panel} aria-labelledby="cart-title">
        <a href="/" className={styles.brand}>
          سوو
        </a>
        <h1 id="cart-title">سبد شما</h1>
        {!cart ? (
          <p>سبد هنوز خالی است. از یک فروشگاه کالایی انتخاب کنید.</p>
        ) : (
          <>
            <p className={styles.store}>{cart.store.name}</p>
            <ul className={styles.items}>
              {cart.items.map((item) => (
                <li key={item.variantId}>
                  <img src={`/api/store/media/${item.image.id}`} alt="" />
                  <span>
                    <b>{item.name}</b>
                    <small>تعداد {item.quantity.toLocaleString("fa-IR")}</small>
                    {item.availability !== "AVAILABLE" ? (
                      <em>موجودی این مورد تغییر کرده است.</em>
                    ) : null}
                    <ItemReviewChanges
                      changes={cart.reviewChanges.filter(
                        (change) =>
                          "variantId" in change && change.variantId === item.variantId,
                      )}
                    />
                    <span className={styles.itemActions}>
                      <button
                        type="button"
                        aria-label={`کم‌کردن تعداد ${item.name}`}
                        disabled={pending || item.quantity <= 1}
                        onClick={() => changeItem(item.variantId, item.quantity - 1)}
                      >
                        −
                      </button>
                      <button
                        type="button"
                        aria-label={`بیشترکردن تعداد ${item.name}`}
                        disabled={pending || item.quantity >= 99}
                        onClick={() => changeItem(item.variantId, item.quantity + 1)}
                      >
                        +
                      </button>
                      <button
                        type="button"
                        aria-label={`حذف ${item.name}`}
                        disabled={pending}
                        onClick={() => changeItem(item.variantId, 0)}
                      >
                        حذف
                      </button>
                    </span>
                  </span>
                  <strong>{formatIrrAsToman(item.unitPrice.amount)}</strong>
                </li>
              ))}
            </ul>
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
            {conflict ? (
              <ConflictChoice conflict={conflict} pending={pending} resolve={resolve} />
            ) : !cart.reviewRequired ? (
              <button type="button" onClick={continueCheckout} disabled={pending}>
                {pending ? "در حال آماده‌سازی…" : "ادامه برای ثبت سفارش"}
              </button>
            ) : null}
          </>
        )}
        {message ? <p role="status">{message}</p> : null}
        <a className={styles.addressLink} href="/addresses">
          مدیریت نشانی‌های تحویل
        </a>
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
