"use client";

import { useRef } from "react";

import styles from "./storefront.module.css";

export function StoreContactDialog({
  storeName,
  phone,
}: {
  storeName: string;
  phone: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);

  return (
    <>
      <button
        className={styles.contactButton}
        type="button"
        onClick={() => dialog.current?.showModal()}
      >
        اطلاعات تماس
      </button>
      <dialog
        className={styles.contactDialog}
        ref={dialog}
        aria-label={`اطلاعات تماس ${storeName}`}
        onClick={(event) => {
          if (event.target === dialog.current) dialog.current?.close();
        }}
      >
        <h2>شماره تماس کاری {storeName}</h2>
        <a href={`tel:${phone}`} dir="ltr">
          {phone}
        </a>
        <button
          className={styles.contactDialogClose}
          type="button"
          onClick={() => dialog.current?.close()}
        >
          بستن
        </button>
      </dialog>
    </>
  );
}
