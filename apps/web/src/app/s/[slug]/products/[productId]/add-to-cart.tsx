"use client";

import { useState } from "react";

import styles from "./product-public.module.css";

export function AddToCart({
  axes,
  variants,
}: {
  axes: Array<{ name: string; values: string[] }>;
  variants: Array<{
    variantId: string;
    label: string;
    priceLabel: string;
    available: boolean;
    combination: Array<{ axis: string; value: string }>;
  }>;
}) {
  const singleVariant = variants.length === 1 ? variants[0] : undefined;
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [quantity, setQuantity] = useState(1);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [replacementRevision, setReplacementRevision] = useState<number>();
  const selectedVariant =
    singleVariant ??
    (axes.every((axis) => choices[axis.name])
      ? variants.find((variant) =>
          axes.every((axis) =>
            variant.combination.some(
              (part) => part.axis === axis.name && part.value === choices[axis.name],
            ),
          ),
        )
      : undefined);
  const variantId = selectedVariant?.variantId;

  function choose(axisIndex: number, value: string) {
    const axis = axes[axisIndex];
    if (!axis) return;
    const next = { ...choices, [axis.name]: value };
    for (const later of axes.slice(axisIndex + 1)) delete next[later.name];
    setChoices(next);
    setMessage("");
    setReplacementRevision(undefined);
  }

  async function add() {
    if (!selectedVariant || !variantId) {
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
          <div className={styles.choiceGroups} aria-label="انتخاب ویژگی‌های کالا">
            {axes.map((axis, axisIndex) => (
              <fieldset className={styles.choiceGroup} key={axis.name}>
                <legend>{axis.name}</legend>
                <div className={styles.choiceOptions}>
                  {axis.values.map((value) => {
                    const matches = variants.filter(
                      (variant) =>
                        variant.combination.some(
                          (part) => part.axis === axis.name && part.value === value,
                        ) &&
                        axes
                          .slice(0, axisIndex)
                          .every(
                            (earlier) =>
                              !choices[earlier.name] ||
                              variant.combination.some(
                                (part) =>
                                  part.axis === earlier.name &&
                                  part.value === choices[earlier.name],
                              ),
                          ),
                    );
                    const unavailable =
                      matches.length > 0 &&
                      matches.every((variant) => !variant.available);
                    return (
                      <button
                        type="button"
                        className={styles.choice}
                        aria-pressed={choices[axis.name] === value}
                        disabled={pending || matches.length === 0}
                        onClick={() => choose(axisIndex, value)}
                        key={value}
                      >
                        {value}
                        {unavailable ? " · ناموجود" : ""}
                      </button>
                    );
                  })}
                </div>
              </fieldset>
            ))}
          </div>
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
