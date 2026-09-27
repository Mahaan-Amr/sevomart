"use client";

import {
  checkoutOptionsV2Contract,
  checkoutPreparationV2Contract,
  purchaseGroupContract,
  type CheckoutOptionsV2,
  type CheckoutPreparationV2,
} from "@sevo/contracts/orders/v2";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

import { formatIrrAsToman } from "../../../lib/format-money";
import { loginHref } from "../../../lib/navigation";
import styles from "./checkout.module.css";

const SHIPPING_STORAGE_KEY = "sevo-checkout-shipping-v2";

export function MultiStoreCheckoutView({
  developmentPayment,
}: {
  developmentPayment: boolean;
}) {
  const router = useRouter();
  const isReview = usePathname() === "/checkout/review";
  const [options, setOptions] = useState<CheckoutOptionsV2>();
  const [shippingByStore, setShippingByStore] = useState<Record<string, string>>({});
  const [addressId, setAddressId] = useState("");
  const [review, setReview] = useState<CheckoutPreparationV2>();
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    void loadOptions();
  }, []);
  useEffect(() => {
    if (isReview && !review) router.replace("/checkout/delivery");
  }, [isReview, review, router]);

  async function loadOptions() {
    try {
      const response = await fetch("/api/checkout/v2/options", { cache: "no-store" });
      if (response.status === 401) {
        window.location.assign(loginHref("/checkout/delivery", "/cart"));
        return;
      }
      const parsed = checkoutOptionsV2Contract.safeParse(await response.json());
      if (!response.ok || !parsed.success) {
        setMessage("مرور سفارش آماده نشد. سبد را دوباره بررسی کنید.");
        return;
      }
      setOptions(parsed.data);
      const savedShipping = readStoredShipping(
        sessionStorage.getItem(SHIPPING_STORAGE_KEY),
      );
      setShippingByStore(
        Object.fromEntries(
          parsed.data.stores.map((store) => [
            store.storeId,
            store.shippingMethods.find(
              (method) => method.id === savedShipping[store.storeId],
            )?.id ??
              store.shippingMethods[0]?.id ??
              "",
          ]),
        ),
      );
      setAddressId(parsed.data.addresses[0]?.addressId ?? "");
    } catch {
      setMessage("ارتباط برقرار نشد. دوباره تلاش کنید.");
    }
  }

  async function prepare() {
    if (!options) return;
    const selected = options.stores.map((store) => ({
      storeId: store.storeId,
      method: store.shippingMethods.find(
        (method) => method.id === shippingByStore[store.storeId],
      ),
    }));
    if (selected.some((entry) => !entry.method)) {
      setMessage(
        "برای هر فروشگاه روش ارسال انتخاب کنید. اگر روشی نیست، به سبد برگردید و آن کالا را بردارید.",
      );
      return;
    }
    const needsAddress = selected.some(
      (entry) => entry.method?.requiresDeliveryAddress,
    );
    const address = options.addresses.find((entry) => entry.addressId === addressId);
    if (needsAddress && !address) {
      setMessage("برای روش ارسال انتخاب‌شده، نشانی تحویل ثبت کنید.");
      return;
    }
    setPending(true);
    setMessage("");
    try {
      const response = await fetch("/api/checkout/v2/prepare", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          cartId: options.cart.cartId,
          cartRevision: options.cart.revision,
          ...(needsAddress && address
            ? { savedAddressId: address.addressId, addressRevision: address.revision }
            : {}),
          shipping: selected.map((entry) => ({
            storeId: entry.storeId,
            shippingMethodId: entry.method!.id,
            shippingMethodRevision: entry.method!.revision,
          })),
        }),
      });
      const body = await response.json();
      const parsed = checkoutPreparationV2Contract.safeParse(body);
      if (!response.ok || !parsed.success) {
        setMessage(
          body.message ??
            "اطلاعات یکی از فروشگاه‌ها تغییر کرده است. همهٔ خرید را دوباره بررسی کنید.",
        );
        await loadOptions();
        return;
      }
      setReview(parsed.data);
      router.push("/checkout/review");
    } catch {
      setMessage("مرور سفارش آماده نشد. دوباره تلاش کنید.");
    } finally {
      setPending(false);
    }
  }

  async function createPurchase() {
    if (!review || !developmentPayment) return;
    setPending(true);
    setMessage("");
    try {
      const response = await fetch("/api/purchase-groups", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": crypto.randomUUID(),
        },
        body: JSON.stringify({
          checkoutRevision: review.checkoutRevision,
          cartRevision: review.cart.revision,
        }),
      });
      const body = await response.json();
      const parsed = purchaseGroupContract.safeParse(body);
      if (!response.ok || !parsed.success) {
        setMessage(
          body.message ??
            "یکی از کالاها یا روش‌های ارسال تغییر کرده است. کل خرید را دوباره بررسی کنید.",
        );
        return;
      }
      sessionStorage.removeItem(SHIPPING_STORAGE_KEY);
      window.location.assign(`/purchases/${encodeURIComponent(parsed.data.groupId)}`);
    } catch {
      setMessage("ثبت خرید انجام نشد. دوباره تلاش کنید.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className={styles.page}>
      <section className={styles.panel} aria-labelledby="checkout-title">
        <a className={styles.back} href={isReview ? "/checkout/delivery" : "/cart"}>
          بازگشت
        </a>
        <h1 id="checkout-title">{isReview ? "مرور نهایی خرید" : "تحویل سفارش"}</h1>
        {isReview && review ? (
          <>
            {review.stores.map((store) => (
              <section
                className={styles.storeGroup}
                key={store.store.storeId}
                aria-label={`فروشگاه ${store.store.name}`}
              >
                <h2>{store.store.name}</h2>
                <ul className={styles.items}>
                  {store.items.map((item) => (
                    <li key={item.variantId}>
                      <span>
                        {item.name} × {item.quantity.toLocaleString("fa-IR")}
                      </span>
                      <strong>{formatIrrAsToman(item.lineTotal.amount)}</strong>
                    </li>
                  ))}
                </ul>
                <p>
                  ارسال: {store.shippingMethod.label}،{" "}
                  {formatIrrAsToman(store.shippingMethod.fee.amount)}
                </p>
                <p>مرجوعی: {store.returnPolicy.text}</p>
                <p>
                  جمع این فروشگاه:{" "}
                  <strong>{formatIrrAsToman(store.total.amount)}</strong>
                </p>
              </section>
            ))}
            <div className={styles.total}>
              <span>مبلغ نهایی یک پرداخت</span>
              <strong>{formatIrrAsToman(review.total.amount)}</strong>
            </div>
            <p className={styles.trust}>
              روش تسویهٔ هر فروشگاه مستقیم است. سوو گزارش مشکل را پیگیری می‌کند، اما
              بازپرداخت را تضمین نمی‌کند. پیگیری و مرجوعی هر فروشگاه جداست.
            </p>
            {developmentPayment ? (
              <p className={styles.devNotice}>
                این پرداخت فقط آزمایشی و در محیط توسعه است؛ پول واقعی جابه‌جا نمی‌شود.
              </p>
            ) : (
              <p className={styles.devNotice}>
                پرداخت یک‌جای واقعی پس از آماده‌شدن ارائه‌دهنده فعال می‌شود.
              </p>
            )}
            <button
              className={styles.primary}
              type="button"
              disabled={pending || !developmentPayment}
              onClick={createPurchase}
            >
              {pending ? "در حال ثبت…" : "ثبت خرید و ادامه به پرداخت"}
            </button>
          </>
        ) : !isReview && options ? (
          <>
            {options.stores.map((store) => (
              <fieldset key={store.storeId}>
                <legend>ارسال از {store.name}</legend>
                {store.shippingMethods.length ? (
                  store.shippingMethods.map((method) => (
                    <label className={styles.choice} key={method.id}>
                      <input
                        type="radio"
                        name={`shipping-${store.storeId}`}
                        value={method.id}
                        checked={shippingByStore[store.storeId] === method.id}
                        onChange={() =>
                          setShippingByStore((current) => {
                            const next = { ...current, [store.storeId]: method.id };
                            sessionStorage.setItem(
                              SHIPPING_STORAGE_KEY,
                              JSON.stringify(next),
                            );
                            return next;
                          })
                        }
                      />
                      <span>
                        <strong>
                          {method.label}، {formatIrrAsToman(method.fee.amount)}
                        </strong>
                        <small>{method.estimatedDeliveryText}</small>
                      </span>
                    </label>
                  ))
                ) : (
                  <p role="status">
                    این فروشگاه اکنون روش ارسال قابل انتخاب ندارد. نشانی را بررسی کنید
                    یا کالایش را از سبد بردارید.
                  </p>
                )}
              </fieldset>
            ))}
            {options.stores.some(
              (store) =>
                store.shippingMethods.find(
                  (method) => method.id === shippingByStore[store.storeId],
                )?.requiresDeliveryAddress,
            ) ? (
              <fieldset>
                <legend>نشانی تحویل</legend>
                {options.addresses.map((address) => (
                  <label className={styles.choice} key={address.addressId}>
                    <input
                      type="radio"
                      name="address"
                      value={address.addressId}
                      checked={addressId === address.addressId}
                      onChange={() => setAddressId(address.addressId)}
                    />
                    <span>
                      <strong>{address.recipientName}</strong>
                      <small>
                        {address.provinceText}، {address.cityText}،{" "}
                        {address.addressLine}
                      </small>
                    </span>
                  </label>
                ))}
                <a href="/account/addresses?returnTo=%2Fcheckout%2Fdelivery">
                  {options.addresses.length
                    ? "افزودن نشانی دیگر"
                    : "افزودن نشانی تحویل"}
                </a>
              </fieldset>
            ) : null}
            <p className={styles.note}>
              هزینهٔ ارسال و شرایط مرجوعی هر فروشگاه را در قدم بعد، پیش از ثبت خرید،
              می‌بینید.
            </p>
            <button
              className={styles.primary}
              type="button"
              disabled={
                pending ||
                options.stores.some((store) => !shippingByStore[store.storeId])
              }
              onClick={prepare}
            >
              {pending ? "در حال بررسی…" : "مرور مبلغ نهایی"}
            </button>
          </>
        ) : (
          <p role="status">در حال آماده‌کردن روش‌های تحویل…</p>
        )}
        {message ? (
          <p className={styles.error} role="alert">
            {message} <a href="/cart">بازگشت به سبد</a>
          </p>
        ) : null}
      </section>
    </main>
  );
}

function readStoredJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function readStoredShipping(value: string | null): Record<string, string> {
  if (!value) return {};
  const parsed = readStoredJson(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  return Object.fromEntries(
    Object.entries(parsed).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}
