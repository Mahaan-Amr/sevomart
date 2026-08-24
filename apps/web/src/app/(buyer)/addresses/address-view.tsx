"use client";

import {
  savedAddressContract,
  savedAddressListContract,
  type SavedAddress,
} from "@sevo/contracts/orders/v1";
import { FormEvent, useEffect, useState } from "react";

import styles from "./address.module.css";

type AddressFields = Omit<SavedAddress, "addressId" | "revision">;

const emptyAddress: AddressFields = {
  recipientName: "",
  recipientMobile: "",
  provinceText: "",
  cityText: "",
  addressLine: "",
};

export function AddressView() {
  const [addresses, setAddresses] = useState<SavedAddress[]>([]);
  const [editing, setEditing] = useState<SavedAddress>();
  const [fields, setFields] = useState<AddressFields>(emptyAddress);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    const response = await fetch("/api/addresses", { cache: "no-store" });
    if (response.status === 401) {
      window.location.assign("/login?returnTo=%2Faddresses&cancelTo=%2Fcart");
      return;
    }
    const parsed = savedAddressListContract.safeParse(await response.json());
    if (parsed.success) setAddresses(parsed.data.addresses);
    else setMessage("نشانی‌ها بارگیری نشدند. دوباره تلاش کنید.");
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setMessage("");
    const response = await fetch(
      editing ? `/api/addresses/${editing.addressId}` : "/api/addresses",
      {
        method: editing ? "PUT" : "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": crypto.randomUUID(),
        },
        body: JSON.stringify({
          ...fields,
          postalCode: fields.postalCode || undefined,
          ...(editing ? { expectedRevision: editing.revision } : {}),
        }),
      },
    );
    const body = await response.json();
    const parsed = savedAddressContract.safeParse(body);
    if (response.ok && parsed.success) {
      setEditing(undefined);
      setFields(emptyAddress);
      setMessage(editing ? "ویرایش نشانی ذخیره شد." : "نشانی ذخیره شد.");
      await load();
    } else {
      setMessage(
        typeof body?.message === "string"
          ? body.message
          : "نشانی ذخیره نشد. اطلاعات را بررسی کنید.",
      );
      if (body?.currentAddress) {
        const current = savedAddressContract.safeParse(body.currentAddress);
        if (current.success) beginEdit(current.data);
      }
    }
    setPending(false);
  }

  function beginEdit(address: SavedAddress) {
    setEditing(address);
    setFields({
      recipientName: address.recipientName,
      recipientMobile: address.recipientMobile,
      provinceText: address.provinceText,
      cityText: address.cityText,
      addressLine: address.addressLine,
      ...(address.postalCode ? { postalCode: address.postalCode } : {}),
    });
    setMessage("");
  }

  async function remove(address: SavedAddress) {
    setPending(true);
    const response = await fetch(`/api/addresses/${address.addressId}`, {
      method: "DELETE",
      headers: {
        "content-type": "application/json",
        "idempotency-key": crypto.randomUUID(),
      },
      body: JSON.stringify({ expectedRevision: address.revision }),
    });
    setMessage(response.ok ? "نشانی از انتخاب‌های آینده حذف شد." : "نشانی حذف نشد.");
    if (response.ok) await load();
    setPending(false);
  }

  return (
    <main className={styles.page}>
      <section className={styles.panel} aria-labelledby="address-title">
        <a href="/cart" className={styles.back}>
          بازگشت به سبد
        </a>
        <h1 id="address-title">نشانی تحویل</h1>
        <p className={styles.help}>
          نشانی را برای انتخاب در مرحله مرور سفارش نگه دارید. ویرایش، نسخه تازه‌ای
          می‌سازد و سفارش‌های قبلی را تغییر نمی‌دهد.
        </p>
        {addresses.length ? (
          <ul className={styles.list} aria-label="نشانی‌های ذخیره‌شده">
            {addresses.map((address) => (
              <li key={address.addressId}>
                <strong>{address.recipientName}</strong>
                <span>
                  {address.provinceText}، {address.cityText}، {address.addressLine}
                </span>
                <small>{address.recipientMobile}</small>
                <div className={styles.rowActions}>
                  <button type="button" onClick={() => beginEdit(address)}>
                    ویرایش
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(address)}
                    disabled={pending}
                  >
                    حذف
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p>هنوز نشانی‌ای ذخیره نشده است.</p>
        )}
        <form onSubmit={submit} className={styles.form}>
          <h2>{editing ? "ویرایش نشانی" : "افزودن نشانی"}</h2>
          <Field
            label="نام گیرنده"
            value={fields.recipientName}
            onChange={(recipientName) => setFields({ ...fields, recipientName })}
          />
          <Field
            label="شماره موبایل گیرنده"
            inputMode="tel"
            value={fields.recipientMobile}
            onChange={(recipientMobile) => setFields({ ...fields, recipientMobile })}
          />
          <div className={styles.columns}>
            <Field
              label="استان"
              value={fields.provinceText}
              onChange={(provinceText) => setFields({ ...fields, provinceText })}
            />
            <Field
              label="شهر"
              value={fields.cityText}
              onChange={(cityText) => setFields({ ...fields, cityText })}
            />
          </div>
          <label>
            نشانی کامل
            <textarea
              required
              value={fields.addressLine}
              onChange={(event) =>
                setFields({ ...fields, addressLine: event.target.value })
              }
            />
          </label>
          <Field
            label="کدپستی (در صورت نیاز)"
            inputMode="numeric"
            required={false}
            value={fields.postalCode ?? ""}
            onChange={(postalCode) => setFields({ ...fields, postalCode })}
          />
          <button className={styles.primary} disabled={pending}>
            {pending ? "در حال ذخیره…" : editing ? "ذخیره ویرایش" : "ذخیره نشانی"}
          </button>
          {editing ? (
            <button
              type="button"
              className={styles.cancel}
              onClick={() => {
                setEditing(undefined);
                setFields(emptyAddress);
              }}
            >
              انصراف از ویرایش
            </button>
          ) : null}
        </form>
        {message ? <p role="status">{message}</p> : null}
      </section>
    </main>
  );
}

function Field({
  label,
  value,
  onChange,
  required = true,
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  inputMode?: "tel" | "numeric";
}) {
  return (
    <label>
      {label}
      <input
        required={required}
        inputMode={inputMode}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}
