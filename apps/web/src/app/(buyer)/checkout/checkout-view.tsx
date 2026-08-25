"use client";

import {
  checkoutOptionsContract,
  checkoutPreparationContract,
  checkoutRevisionConflictContract,
  orderContract,
  type CheckoutOptions,
  type CheckoutPreparation,
  type CheckoutChange,
  type Order,
} from "@sevo/contracts/orders/v1";
import { useEffect, useRef, useState } from "react";

import { formatIrrAsToman } from "../../../lib/format-money";
import styles from "./checkout.module.css";

export function CheckoutView() {
  const [options, setOptions] = useState<CheckoutOptions>();
  const [shippingId, setShippingId] = useState("");
  const [addressId, setAddressId] = useState("");
  const [review, setReview] = useState<CheckoutPreparation>();
  const [order, setOrder] = useState<Order>();
  const [message, setMessage] = useState("");
  const [conflictChanges, setConflictChanges] = useState<CheckoutChange[]>([]);
  const [errorAction, setErrorAction] = useState<
    "cart" | "address" | "review" | "retry"
  >("cart");
  const [pending, setPending] = useState(false);
  const errorRef = useRef<HTMLDivElement>(null);
  const orderIdempotencyKey = useRef("");

  useEffect(() => {
    void loadOptions();
  }, []);

  async function loadOptions() {
    const response = await fetch("/api/checkout/options", { cache: "no-store" });
    if (response.status === 401) {
      window.location.assign("/login?returnTo=%2Fcheckout&cancelTo=%2Fcart");
      return;
    }
    const parsed = checkoutOptionsContract.safeParse(await response.json());
    if (!parsed.success) {
      showError("مرور سفارش آماده نشد؛ به سبد برگردید و دوباره تلاش کنید.");
      return;
    }
    setOptions(parsed.data);
    setShippingId(parsed.data.shippingMethods[0]?.id ?? "");
    setAddressId(parsed.data.addresses[0]?.addressId ?? "");
  }

  async function prepare() {
    if (!options) return;
    const shipping = options.shippingMethods.find((item) => item.id === shippingId);
    const address = options.addresses.find((item) => item.addressId === addressId);
    if (!shipping) return;
    if (shipping.requiresDeliveryAddress && !address) {
      showError("برای این روش ارسال، یک نشانی تحویل انتخاب یا اضافه کنید.");
      return;
    }
    setPending(true);
    setMessage("");
    const response = await fetch("/api/checkout/prepare", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        cartId: options.cart.cartId,
        cartRevision: options.cart.revision,
        shippingMethodId: shipping.id,
        shippingMethodRevision: shipping.revision,
        ...(address
          ? { savedAddressId: address.addressId, addressRevision: address.revision }
          : {}),
      }),
    });
    const body = await response.json();
    const parsed = checkoutPreparationContract.safeParse(body);
    if (response.ok && parsed.success) {
      orderIdempotencyKey.current = crypto.randomUUID();
      setReview(parsed.data);
    } else showCheckoutError(body);
    setPending(false);
  }

  async function createOrder() {
    if (!review) return;
    setPending(true);
    const response = await fetch("/api/orders", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key":
          orderIdempotencyKey.current ||
          (orderIdempotencyKey.current = crypto.randomUUID()),
      },
      body: JSON.stringify({
        checkoutRevision: review.checkoutRevision,
        cartRevision: review.cart.revision,
        ...(review.address ? { addressRevision: review.address.revision } : {}),
        shippingMethodRevision: review.shippingMethod.revision,
        returnPolicyRevision: review.returnPolicy.revision,
      }),
    });
    const body = await response.json();
    const parsed = orderContract.safeParse(body);
    if (response.ok && parsed.success) setOrder(parsed.data);
    else showCheckoutError(body);
    setPending(false);
  }

  function showCheckoutError(body: unknown) {
    const parsed = checkoutRevisionConflictContract.safeParse(body);
    if (parsed.success) {
      setConflictChanges(parsed.data.changes ?? []);
      if (parsed.data.code === "IDEMPOTENCY_IN_PROGRESS") {
        setErrorAction("retry");
        showError(parsed.data.message);
        return;
      }
      if (
        parsed.data.code === "ADDRESS_INVALID" ||
        parsed.data.changes?.some((change) => change.kind === "ADDRESS_CHANGED")
      ) {
        setErrorAction("address");
        showError(`${parsed.data.message} نشانی را اصلاح و دوباره تأیید کنید.`);
        return;
      }
      if (
        parsed.data.changes?.some((change) =>
          [
            "SHIPPING_METHOD_CHANGED",
            "SHIPPING_FEE_CHANGED",
            "POLICY_CHANGED",
          ].includes(change.kind),
        )
      ) {
        setReview(undefined);
        setErrorAction("review");
        void loadOptions();
        showError(
          `${parsed.data.message} انتخاب‌ها تازه شد؛ آن‌ها را دوباره مرور کنید.`,
        );
        return;
      }
      const price = parsed.data.changes?.find(
        (change) => change.kind === "PRICE_CHANGED",
      );
      setErrorAction("cart");
      showError(
        price?.kind === "PRICE_CHANGED"
          ? `قیمت از ${formatIrrAsToman(price.previous.amount)} به ${formatIrrAsToman(price.current.amount)} تغییر کرده است؛ سبد را دوباره تأیید کنید.`
          : `${parsed.data.message} سبد را اصلاح و دوباره تأیید کنید.`,
      );
    } else showError("ثبت سفارش انجام نشد. دوباره تلاش کنید.");
  }

  function showError(text: string) {
    setMessage(text);
    queueMicrotask(() => errorRef.current?.focus());
  }

  if (order) {
    return (
      <main className={styles.page}>
        <section className={styles.panel} aria-labelledby="order-title">
          <h1 id="order-title">سفارش ثبت شد</h1>
          <p>
            موجودی تا {new Date(order.reservationExpiresAt).toLocaleTimeString("fa-IR")}
            برای این سفارش رزرو است. قدم بعدی پرداخت مستقیم به فروشگاه است.
          </p>
          <strong>{formatIrrAsToman(order.review.total.amount)}</strong>
          <p className={styles.note}>شناسه سفارش: {order.orderId}</p>
        </section>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <section className={styles.panel} aria-labelledby="checkout-title">
        <a href="/cart" className={styles.back}>
          بازگشت به سبد
        </a>
        <h1 id="checkout-title">مرور نهایی سفارش</h1>
        {!options ? (
          <p>در حال آماده‌کردن انتخاب‌ها…</p>
        ) : !review ? (
          <>
            <fieldset>
              <legend>روش ارسال</legend>
              {options.shippingMethods.map((method) => (
                <label key={method.id} className={styles.choice}>
                  <input
                    type="radio"
                    name="shipping"
                    checked={shippingId === method.id}
                    onChange={() => setShippingId(method.id)}
                  />
                  <span>
                    <b>{method.label}</b>
                    <small>
                      {formatIrrAsToman(method.fee.amount)}،{" "}
                      {method.estimatedDeliveryText}
                    </small>
                  </span>
                </label>
              ))}
            </fieldset>
            {options.shippingMethods.find((method) => method.id === shippingId)
              ?.requiresDeliveryAddress ? (
              <fieldset>
                <legend>نشانی تحویل</legend>
                {options.addresses.map((address) => (
                  <label key={address.addressId} className={styles.choice}>
                    <input
                      type="radio"
                      name="address"
                      checked={addressId === address.addressId}
                      onChange={() => setAddressId(address.addressId)}
                    />
                    <span>
                      <b>{address.recipientName}</b>
                      <small>
                        {address.provinceText}، {address.cityText}،{" "}
                        {address.addressLine}
                      </small>
                    </span>
                  </label>
                ))}
                <a href="/addresses">افزودن یا ویرایش نشانی</a>
              </fieldset>
            ) : null}
            <button className={styles.primary} disabled={pending} onClick={prepare}>
              {pending ? "در حال بررسی…" : "دیدن مبلغ نهایی"}
            </button>
          </>
        ) : (
          <>
            <ul className={styles.items}>
              {review.items.map((item) => (
                <li key={item.variantId}>
                  <span>
                    {item.name} × {item.quantity.toLocaleString("fa-IR")}
                    {conflictChanges.find(
                      (change) =>
                        change.kind === "PRICE_CHANGED" &&
                        change.variantId === item.variantId,
                    ) ? (
                      <small className={styles.itemConflict}>
                        قیمت این کالا تغییر کرده است؛ مبلغ تازه را در پیام پایین ببینید.
                      </small>
                    ) : null}
                  </span>
                  <strong>{formatIrrAsToman(item.lineTotal.amount)}</strong>
                </li>
              ))}
            </ul>
            <div className={styles.total}>
              <span>ارسال</span>
              <b>{formatIrrAsToman(review.shippingMethod.fee.amount)}</b>
              <span>مبلغ نهایی</span>
              <strong>{formatIrrAsToman(review.total.amount)}</strong>
            </div>
            {review.address ? (
              <p className={styles.note}>
                تحویل به {review.address.recipientName}: {review.address.provinceText}،{" "}
                {review.address.cityText}، {review.address.addressLine}
              </p>
            ) : (
              <p className={styles.note}>این سفارش حضوری تحویل می‌شود.</p>
            )}
            <section className={styles.trust} aria-labelledby="settlement-title">
              <h2 id="settlement-title">تسویه مستقیم</h2>
              <p>{review.settlement.disclosure}</p>
              <details>
                <summary>سیاست مرجوعی فروشگاه</summary>
                <p>{review.returnPolicy.text}</p>
              </details>
            </section>
            <button className={styles.primary} disabled={pending} onClick={createOrder}>
              {pending
                ? "در حال ثبت…"
                : `ثبت سفارش با مبلغ ${formatIrrAsToman(review.total.amount)}`}
            </button>
          </>
        )}
        {message ? (
          <div ref={errorRef} tabIndex={-1} role="alert" className={styles.error}>
            {message}
            <div>
              {errorAction === "address" ? (
                <a href="/addresses">اصلاح نشانی</a>
              ) : errorAction === "review" ? (
                <a href="#checkout-title">مرور دوباره انتخاب‌ها</a>
              ) : errorAction === "retry" ? (
                <button type="button" onClick={createOrder}>
                  تلاش دوباره برای ثبت سفارش
                </button>
              ) : (
                <a href="/cart">بازگشت به سبد</a>
              )}
            </div>
          </div>
        ) : null}
      </section>
    </main>
  );
}
