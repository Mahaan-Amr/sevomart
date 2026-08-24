"use client";

import {
  cartContract,
  cartResolutionContract,
  type Cart,
  type CartConflict,
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
                  </span>
                  <strong>{formatIrrAsToman(item.unitPrice.amount)}</strong>
                </li>
              ))}
            </ul>
            {conflict ? (
              <ConflictChoice conflict={conflict} pending={pending} resolve={resolve} />
            ) : (
              <button type="button" onClick={continueCheckout} disabled={pending}>
                {pending ? "در حال آماده‌سازی…" : "ادامه برای ثبت سفارش"}
              </button>
            )}
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
        پیش از ورود سبد «{conflict.guest.storeName}» و در حساب شما سبد «
        {conflict.buyer.storeName}» وجود دارد. تا انتخاب شما چیزی حذف نمی‌شود.
      </p>
      {conflict.kind === "SAME_STORE" ? (
        <button type="button" disabled={pending} onClick={() => resolve("MERGE")}>
          ترکیب دو سبد
        </button>
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
        نگه‌داشتن سبد حساب من
      </button>
    </section>
  );
}
