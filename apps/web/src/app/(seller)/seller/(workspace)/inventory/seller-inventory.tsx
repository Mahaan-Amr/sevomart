"use client";

import {
  inventoryErrorContract,
  sellerInventoryBatchResultContract,
  sellerInventoryListContract,
  type ReplaceSellerInventoryBatch,
  type SellerInventoryList,
} from "@sevo/contracts/inventory/v1";
import { storeDraftContract } from "@sevo/contracts/store/v1";
import { useEffect, useRef, useState } from "react";

import {
  variantLabelsFromPublishedProduct,
  variantLabelsFromSellerProduct,
} from "../../../../../lib/product-variant-labels";

import {
  calculateInventoryTarget,
  type InventoryAdjustmentAction,
  inventoryErrorGuidance,
  type InventoryRecovery,
  matchesInventorySearch,
  type PendingInventoryWrite,
  prepareInventoryWrite,
} from "./seller-inventory-model";
import styles from "./seller-inventory.module.css";

type InventoryItem = SellerInventoryList["items"][number] & {
  variantLabel: string;
};
type ReasonCode = ReplaceSellerInventoryBatch["reasonCode"];
type Editor = {
  variantId: string;
  action: InventoryAdjustmentAction;
  amount: string;
  reasonCode: ReasonCode | "";
  note: string;
};

const actionCopy = {
  INCREASE: { label: "افزایش", input: "مقدار افزایش" },
  DECREASE: { label: "کاهش", input: "مقدار کاهش" },
  CORRECT: { label: "اصلاح", input: "موجودی شمارش‌شده" },
} as const satisfies Record<
  InventoryAdjustmentAction,
  { label: string; input: string }
>;

const reasons: ReadonlyArray<{ value: ReasonCode; label: string }> = [
  { value: "MANUAL_COUNT", label: "شمارش دستی" },
  { value: "DAMAGED", label: "خرابی یا آسیب" },
  { value: "RETURNED_TO_STOCK", label: "بازگشت به موجودی" },
  { value: "CORRECTION", label: "اصلاح ثبت قبلی" },
];

export function SellerInventory() {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [query, setQuery] = useState("");
  const [editor, setEditor] = useState<Editor>();
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const [labelsIncomplete, setLabelsIncomplete] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [recovery, setRecovery] = useState<InventoryRecovery>();
  const pendingWrite = useRef<PendingInventoryWrite | undefined>(undefined);

  useEffect(() => {
    let active = true;
    void readAllInventory().then((result) => {
      if (!active) return;
      if (result.kind === "SIGNED_OUT") {
        window.location.assign("/seller/login?returnTo=%2Fseller%2Finventory");
        return;
      }
      if (result.kind === "FAILED") {
        setFailed(true);
      } else {
        setItems(result.items);
        setLabelsIncomplete(!result.labelsComplete);
      }
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, []);

  const visibleItems = items.filter((item) => matchesInventorySearch(item, query));

  function beginEdit(item: InventoryItem, action: InventoryAdjustmentAction) {
    setEditor({
      variantId: item.variantId,
      action,
      amount: action === "CORRECT" ? item.onHand.toLocaleString("fa-IR") : "",
      reasonCode: "",
      note: "",
    });
    setError("");
    setMessage("");
    setRecovery(undefined);
  }

  async function submitAdjustment(item: InventoryItem) {
    if (!editor) return;
    const target = calculateInventoryTarget(editor.action, item.onHand, editor.amount);
    if ("error" in target) {
      setError(target.error);
      setRecovery(undefined);
      return;
    }
    if (!editor.reasonCode) {
      setError("دلیل تغییر را انتخاب کنید تا سابقه موجودی روشن بماند.");
      setRecovery(undefined);
      return;
    }
    setPending(true);
    setError("");
    setMessage("");
    setRecovery(undefined);
    try {
      const payload: ReplaceSellerInventoryBatch = {
        reasonCode: editor.reasonCode,
        ...(editor.note.trim() ? { note: editor.note.trim() } : {}),
        rows: [
          {
            variantId: item.variantId,
            onHand: target.value,
            expectedRevision: item.revision,
          },
        ],
      };
      const write = prepareInventoryWrite(
        pendingWrite.current,
        JSON.stringify(payload),
        () => crypto.randomUUID(),
      );
      pendingWrite.current = write;
      const response = await fetch("/api/seller/inventory", {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          "idempotency-key": write.idempotencyKey,
        },
        body: write.payload,
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        if (showInventoryError(body)) pendingWrite.current = undefined;
        return;
      }
      const parsed = sellerInventoryBatchResultContract.safeParse(body);
      if (!parsed.success || !parsed.data.rows[0]) throw new Error("invalid response");
      pendingWrite.current = undefined;
      const updated = parsed.data.rows[0];
      setItems((current) =>
        current.map((currentItem) =>
          currentItem.variantId === updated.variantId
            ? { ...currentItem, ...updated }
            : currentItem,
        ),
      );
      setEditor(undefined);
      setMessage(`موجودی «${item.productName}» ثبت شد.`);
    } catch {
      setError("تغییر موجودی ثبت نشد. اتصال را بررسی و دوباره تلاش کنید.");
    } finally {
      setPending(false);
    }
  }

  function showInventoryError(body: unknown) {
    const parsed = inventoryErrorContract.safeParse(body);
    if (!parsed.success) {
      setError(
        "نتیجه درخواست روشن نشد. بدون تغییر اطلاعات، دوباره تلاش کنید تا همان درخواست پیگیری شود.",
      );
      setRecovery(undefined);
      return false;
    }
    const guidance = inventoryErrorGuidance(parsed.data.code);
    setError(guidance.message);
    setRecovery(guidance.recovery);
    return true;
  }

  async function refreshInventory() {
    setPending(true);
    setError("");
    setRecovery(undefined);
    const result = await readAllInventory();
    if (result.kind === "OK") {
      setItems(result.items);
      setLabelsIncomplete(!result.labelsComplete);
      setMessage("موجودی تازه شد؛ حالا می‌توانید دوباره ثبت کنید.");
    } else if (result.kind === "SIGNED_OUT") {
      window.location.assign("/seller/login?returnTo=%2Fseller%2Finventory");
    } else {
      setError("تازه‌سازی انجام نشد. دوباره تلاش کنید.");
      setRecovery("REFRESH");
    }
    setPending(false);
  }

  return (
    <main className={styles.page}>
      <section className={styles.workspace} aria-labelledby="inventory-title">
        <header className={styles.header}>
          <span className={styles.eyebrow}>موجودی</span>
          <h1 id="inventory-title">اصلاح موجودی گونه‌ها</h1>
          <p>گونه را پیدا کنید و مقدار را بدون ورود به ویرایش کامل کالا تغییر دهید.</p>
        </header>

        <label className={styles.search}>
          <span>جست‌وجوی نام کالا یا ویژگی گونه</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="مثلاً فنجان قرمز بزرگ"
            autoComplete="off"
          />
        </label>

        {message ? (
          <p className={styles.success} role="status">
            {message}
          </p>
        ) : null}
        {error ? (
          <div className={styles.error} role="alert" id="inventory-editor-error">
            <p>{error}</p>
            {recovery ? (
              <button
                type="button"
                onClick={() => {
                  if (recovery === "REFRESH") void refreshInventory();
                  if (recovery === "LOGIN") {
                    window.location.assign(
                      "/seller/login?returnTo=%2Fseller%2Finventory",
                    );
                  }
                  if (recovery === "SELLER_HOME") window.location.assign("/seller");
                }}
                disabled={pending}
              >
                {recovery === "REFRESH"
                  ? "گرفتن اطلاعات تازه"
                  : recovery === "LOGIN"
                    ? "ورود دوباره"
                    : "بازگشت به خانه فروشنده"}
              </button>
            ) : null}
          </div>
        ) : null}
        {labelsIncomplete ? (
          <p className={styles.notice} role="status">
            نام بعضی ویژگی‌ها دریافت نشد؛ برای جست‌وجوی دقیق‌تر صفحه را دوباره باز کنید.
          </p>
        ) : null}
        {loading ? (
          <p className={styles.notice} role="status">
            در حال دریافت موجودی…
          </p>
        ) : null}
        {failed ? (
          <div className={styles.error} role="alert">
            <p>موجودی دریافت نشد. دوباره تلاش کنید.</p>
            <button type="button" onClick={() => window.location.reload()}>
              تلاش دوباره
            </button>
          </div>
        ) : null}
        {!loading && !failed && items.length === 0 ? (
          <p className={styles.empty}>هنوز گونهٔ قابل مدیریتی در فروشگاه ندارید.</p>
        ) : null}
        {!loading && items.length > 0 && visibleItems.length === 0 ? (
          <p className={styles.empty}>گونه‌ای با این نام یا ویژگی پیدا نشد.</p>
        ) : null}

        <ul className={styles.list} aria-label="فهرست موجودی گونه‌ها">
          {visibleItems.map((item) => {
            const editing = editor?.variantId === item.variantId;
            return (
              <li className={styles.item} key={item.variantId}>
                <div className={styles.summary}>
                  <div className={styles.identity}>
                    <strong>{item.productName}</strong>
                    <span>{item.variantLabel || "گونه اصلی"}</span>
                    <span className={styles.availability}>
                      {item.available > 0 ? "موجود" : "ناموجود"}
                    </span>
                  </div>
                  <dl className={styles.counts}>
                    <div>
                      <dt>موجودی</dt>
                      <dd>{item.onHand.toLocaleString("fa-IR")}</dd>
                    </div>
                    <div>
                      <dt>رزروشده</dt>
                      <dd>{item.reserved.toLocaleString("fa-IR")}</dd>
                    </div>
                    <div>
                      <dt>قابل فروش</dt>
                      <dd>{item.available.toLocaleString("fa-IR")}</dd>
                    </div>
                  </dl>
                </div>
                <div
                  className={styles.actions}
                  role="group"
                  aria-label={`اصلاح ${item.productName}`}
                >
                  {(Object.keys(actionCopy) as InventoryAdjustmentAction[]).map(
                    (action) => (
                      <button
                        type="button"
                        key={action}
                        className={
                          editing && editor.action === action
                            ? styles.activeAction
                            : styles.action
                        }
                        aria-label={`${actionCopy[action].label} موجودی ${item.productName}، ${item.variantLabel || "گونه اصلی"}`}
                        aria-pressed={editing && editor.action === action}
                        onClick={() => beginEdit(item, action)}
                      >
                        {actionCopy[action].label}
                      </button>
                    ),
                  )}
                </div>
                {editing ? (
                  <div className={styles.editor}>
                    <label>
                      <span>{actionCopy[editor.action].input}</span>
                      <input
                        inputMode="numeric"
                        value={editor.amount}
                        onChange={(event) =>
                          setEditor({ ...editor, amount: event.target.value })
                        }
                        aria-describedby={error ? "inventory-editor-error" : undefined}
                        autoFocus
                      />
                    </label>
                    <label>
                      <span>دلیل تغییر</span>
                      <select
                        value={editor.reasonCode}
                        onChange={(event) =>
                          setEditor({
                            ...editor,
                            reasonCode: event.target.value as ReasonCode,
                          })
                        }
                      >
                        <option value="">دلیل را انتخاب کنید</option>
                        {reasons.map((reason) => (
                          <option key={reason.value} value={reason.value}>
                            {reason.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className={styles.note}>
                      <span>توضیح اختیاری</span>
                      <input
                        value={editor.note}
                        maxLength={500}
                        onChange={(event) =>
                          setEditor({ ...editor, note: event.target.value })
                        }
                        placeholder="مثلاً نتیجه شمارش پایان روز"
                      />
                    </label>
                    <div className={styles.editorActions}>
                      <button
                        type="button"
                        className={styles.submit}
                        onClick={() => void submitAdjustment(item)}
                        disabled={pending}
                      >
                        {pending ? "در حال ثبت…" : "ذخیره موجودی"}
                      </button>
                      <button
                        type="button"
                        className={styles.cancel}
                        onClick={() => setEditor(undefined)}
                        disabled={pending}
                      >
                        انصراف
                      </button>
                    </div>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </section>
    </main>
  );
}

async function readAllInventory(): Promise<
  | { kind: "OK"; items: InventoryItem[]; labelsComplete: boolean }
  | { kind: "SIGNED_OUT" }
  | { kind: "FAILED" }
> {
  try {
    const inventory: SellerInventoryList["items"] = [];
    let cursor: string | null = null;
    const seenCursors = new Set<string>();
    do {
      const search = new URLSearchParams({ limit: "50" });
      if (cursor) search.set("cursor", cursor);
      const response = await fetch(`/api/seller/inventory?${search}`, {
        cache: "no-store",
      });
      if (response.status === 401) return { kind: "SIGNED_OUT" };
      const parsed = sellerInventoryListContract.safeParse(await response.json());
      if (!response.ok || !parsed.success) return { kind: "FAILED" };
      inventory.push(...parsed.data.items);
      cursor = parsed.data.nextCursor;
      if (cursor && seenCursors.has(cursor)) return { kind: "FAILED" };
      if (cursor) seenCursors.add(cursor);
    } while (cursor);

    const labels = new Map<string, string>();
    const storeSlug = await readPublishedStoreSlug();
    await Promise.all(
      [...new Set(inventory.map((item) => item.productId))].map(async (productId) => {
        if (storeSlug) {
          try {
            const publicResponse = await fetch(
              `/api/store/stores/${encodeURIComponent(storeSlug)}/products/${productId}`,
              { cache: "no-store" },
            );
            if (publicResponse.ok) {
              for (const [variantId, label] of variantLabelsFromPublishedProduct(
                await publicResponse.json(),
              )) {
                labels.set(variantId, label);
              }
            }
          } catch {
            // The private seller read below remains a safe fallback.
          }
        }
        const productVariantIds = inventory
          .filter((item) => item.productId === productId)
          .map((item) => item.variantId);
        if (productVariantIds.every((variantId) => labels.has(variantId))) return;
        try {
          const response = await fetch(`/api/store/seller/products/${productId}`, {
            cache: "no-store",
          });
          if (!response.ok) throw new Error("product unavailable");
          for (const [variantId, label] of variantLabelsFromSellerProduct(
            await response.json(),
          )) {
            if (!labels.has(variantId)) labels.set(variantId, label);
          }
        } catch {
          // Missing labels are reported after all available reads are exhausted.
        }
      }),
    );
    return {
      kind: "OK",
      items: inventory.map((item) => ({
        ...item,
        variantLabel: labels.get(item.variantId) ?? "",
      })),
      labelsComplete: inventory.every((item) => labels.has(item.variantId)),
    };
  } catch {
    return { kind: "FAILED" };
  }
}

async function readPublishedStoreSlug() {
  try {
    const response = await fetch("/api/store/seller/store/draft", {
      cache: "no-store",
    });
    const parsed = storeDraftContract.safeParse(await response.json());
    return response.ok && parsed.success ? parsed.data.slug : null;
  } catch {
    return null;
  }
}
