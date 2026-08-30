"use client";

import { useState } from "react";

import styles from "./product-public.module.css";

export function AddToCart({
  variants,
}: {
  variants: Array<{
    variantId: string;
    label: string;
    priceLabel: string;
    available: boolean;
  }>;
}) {
  const singleVariant = variants.length === 1 ? variants[0] : undefined;
  const [variantId, setVariantId] = useState(singleVariant?.variantId ?? "");
  const [quantity, setQuantity] = useState(1);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [replacementRevision, setReplacementRevision] = useState<number>();
  const selectedVariant = variants.find((variant) => variant.variantId === variantId);

  async function add() {
    if (!selectedVariant) {
      setMessage("ابتدا گونه کالا را انتخاب کنید.");
      return;
    }
    setPending(true);
    setMessage("");
    try {
      const current = await fetch("/api/cart", { cache: "no-store" });
      const currentBody = (await current.json()) as { cart?: { revision?: number } };
      const response = await fetch(`/api/cart/items/${variantId}`, {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          "idempotency-key": crypto.randomUUID(),
          "x-sevo-guest-scope": guestScope(),
        },
        body: JSON.stringify({
          variantId,
          quantity,
          expectedRevision: currentBody.cart?.revision ?? 0,
        }),
      });
      const body = (await response.json()) as { code?: string; message?: string };
      if (!response.ok) {
        if (
          body.code === "STORE_REPLACEMENT_CONFIRMATION_REQUIRED" &&
          typeof currentBody.cart?.revision === "number"
        ) {
          setReplacementRevision(currentBody.cart.revision);
        }
        setMessage(body.message ?? "افزودن به سبد انجام نشد.");
        return;
      }
      setMessage("به سبد اضافه شد.");
    } catch {
      setMessage("ارتباط با سرور برقرار نشد. دوباره تلاش کنید.");
    } finally {
      setPending(false);
    }
  }

  async function replaceStore() {
    if (replacementRevision === undefined || !selectedVariant) return;
    setPending(true);
    try {
      const response = await fetch("/api/cart/store-replacement", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": crypto.randomUUID(),
        },
        body: JSON.stringify({
          variantId,
          quantity,
          expectedRevision: replacementRevision,
          confirmed: true,
        }),
      });
      const body = (await response.json()) as { message?: string };
      if (!response.ok) {
        setMessage(body.message ?? "تغییر فروشگاه انجام نشد.");
        return;
      }
      setReplacementRevision(undefined);
      setMessage("سبد فروشگاه قبلی کنار گذاشته شد و کالا به سبد تازه اضافه شد.");
    } catch {
      setMessage("ارتباط با سرور برقرار نشد. دوباره تلاش کنید.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className={styles.cartAction}>
      {variants.length > 1 ? (
        <>
          <div className={styles.selectedOffer} role="status" aria-live="polite">
            {selectedVariant ? (
              <>
                <span>قیمت گونه انتخاب‌شده</span>
                <strong>{selectedVariant.priceLabel}</strong>
                <span>{selectedVariant.available ? "موجود" : "ناموجود"}</span>
              </>
            ) : (
              <span className={styles.selectionHint}>
                برای دیدن قیمت و موجودی، گونه را انتخاب کنید.
              </span>
            )}
          </div>
          <label htmlFor="cart-variant">گونه</label>
          <select
            id="cart-variant"
            value={variantId}
            onChange={(event) => setVariantId(event.target.value)}
            disabled={pending}
          >
            <option value="" disabled>
              انتخاب گونه
            </option>
            {variants.map((variant) => (
              <option key={variant.variantId} value={variant.variantId}>
                {variant.label}
                {variant.available ? "" : " — ناموجود"}
              </option>
            ))}
          </select>
        </>
      ) : null}
      <label htmlFor="cart-quantity">تعداد</label>
      <select
        id="cart-quantity"
        value={quantity}
        onChange={(event) => setQuantity(Number(event.target.value))}
        disabled={!selectedVariant?.available || pending}
      >
        {[1, 2, 3, 4, 5].map((value) => (
          <option key={value} value={value}>
            {value.toLocaleString("fa-IR")}
          </option>
        ))}
      </select>
      {replacementRevision === undefined ? (
        <button
          type="button"
          onClick={add}
          disabled={!selectedVariant?.available || pending}
        >
          {pending
            ? "در حال افزودن…"
            : !selectedVariant
              ? "گونه را انتخاب کنید"
              : selectedVariant.available
                ? "افزودن به سبد"
                : "فعلاً ناموجود"}
        </button>
      ) : null}
      {message ? <p role="status">{message}</p> : null}
      {replacementRevision !== undefined ? (
        <button
          className={styles.replacementAction}
          type="button"
          onClick={replaceStore}
          disabled={pending}
        >
          تغییر فروشگاه و افزودن
        </button>
      ) : null}
      {message === "به سبد اضافه شد." || message.includes("سبد تازه") ? (
        <a href="/cart">دیدن سبد</a>
      ) : null}
    </div>
  );
}

function guestScope() {
  const key = "sevo_guest_scope";
  const existing = sessionStorage.getItem(key);
  if (existing) return existing;
  const created = crypto.randomUUID();
  sessionStorage.setItem(key, created);
  return created;
}
