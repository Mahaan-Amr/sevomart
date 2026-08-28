"use client";

import {
  publicProductListContract,
  publicSimpleProductListContract,
  sellerProductViewContract,
} from "@sevo/contracts/product/v1";
import { storeDraftContract } from "@sevo/contracts/store/v1";
import { useEffect, useState } from "react";

import styles from "../workspace-page.module.css";
import {
  buildInventoryWrite,
  toInventoryProduct,
  type InventoryProduct,
} from "./seller-inventory-model";

export function SellerInventory() {
  const [products, setProducts] = useState<InventoryProduct[]>();
  const [message, setMessage] = useState("");
  const [pendingId, setPendingId] = useState<string>();

  useEffect(() => {
    void loadInventory();
  }, []);

  async function loadInventory() {
    setMessage("");
    try {
      const draftResponse = await fetch("/api/store/seller/store/draft", {
        cache: "no-store",
      });
      if (draftResponse.status === 404) {
        setProducts([]);
        setMessage("پس از ساخت فروشگاه، موجودی کالاهای منتشرشده اینجا دیده می‌شود.");
        return;
      }
      const draftBody: unknown = await draftResponse.json();
      const draft = storeDraftContract.safeParse(draftBody);
      if (!draftResponse.ok || !draft.success || !draft.data.slug) {
        throw new Error("store unavailable");
      }
      const listResponse = await fetch(
        `/api/store/stores/${encodeURIComponent(draft.data.slug)}/products`,
        { cache: "no-store" },
      );
      if (listResponse.status === 404) {
        setProducts([]);
        setMessage("فروشگاه را منتشر کنید تا موجودی کالاهای آن اینجا دیده شود.");
        return;
      }
      const listBody: unknown = await listResponse.json();
      const multivariant = publicProductListContract.safeParse(listBody);
      const simple = publicSimpleProductListContract.safeParse(listBody);
      if (!listResponse.ok || (!multivariant.success && !simple.success)) {
        throw new Error("products unavailable");
      }
      const summaries = multivariant.success
        ? multivariant.data.products
        : simple.data!.products;
      const loaded = await Promise.all(
        summaries.map(async (summary) => {
          const response = await fetch(
            `/api/store/seller/products/${summary.productId}`,
            { cache: "no-store" },
          );
          const body: unknown = await response.json();
          const parsed = sellerProductViewContract.safeParse(body);
          if (!response.ok || !parsed.success) throw new Error("product unavailable");
          return toInventoryProduct(summary.name, parsed.data);
        }),
      );
      setProducts(loaded);
      if (loaded.length === 0) {
        setMessage("هنوز کالای منتشرشده‌ای برای مدیریت موجودی ندارید.");
      }
    } catch {
      setProducts([]);
      setMessage("موجودی بارگیری نشد. دوباره تلاش کنید.");
    }
  }

  function changeQuantity(productId: string, variantId: string, value: string) {
    const quantity = Math.max(0, Number.parseInt(value || "0", 10) || 0);
    setProducts((current) =>
      current?.map((product) =>
        product.productId !== productId
          ? product
          : {
              ...product,
              rows: product.rows.map((row) =>
                row.variantId === variantId ? { ...row, onHand: quantity } : row,
              ),
            },
      ),
    );
  }

  async function save(product: InventoryProduct) {
    setPendingId(product.productId);
    setMessage("");
    try {
      const write = buildInventoryWrite(product);
      const response = await fetch(
        `/api/store/seller/products/${product.productId}/${write.endpoint}`,
        {
          method: "PUT",
          headers: {
            "content-type": "application/json",
            "idempotency-key": crypto.randomUUID(),
            "if-match": `"${product.product.revision}"`,
          },
          body: JSON.stringify(write.body),
        },
      );
      if (!response.ok) {
        setMessage(
          response.status === 409
            ? "موجودی جای دیگری تغییر کرده است. صفحه را تازه کنید و دوباره بنویسید."
            : "ذخیره موجودی انجام نشد. دوباره تلاش کنید.",
        );
        return;
      }
      await loadInventory();
      setMessage("موجودی ذخیره شد.");
    } catch {
      setMessage("ذخیره موجودی انجام نشد. دوباره تلاش کنید.");
    } finally {
      setPendingId(undefined);
    }
  }

  return (
    <main className={styles.page}>
      <section className={styles.workspace} aria-labelledby="seller-inventory-title">
        <span className={styles.eyebrow}>موجودی</span>
        <h1 id="seller-inventory-title">مدیریت موجودی</h1>
        <p>تعداد گونه‌ها را مستقیم و بدون ورود به ویرایش کامل کالا اصلاح کنید.</p>
        {products === undefined ? <p>در حال بارگیری موجودی…</p> : null}
        <div className={styles.inventoryList}>
          {products?.map((product) => (
            <section className={styles.inventoryProduct} key={product.productId}>
              <h2>{product.name}</h2>
              {product.rows.map((row) => (
                <label className={styles.inventoryRow} key={row.variantId}>
                  <span>{row.label}</span>
                  <input
                    type="number"
                    min="0"
                    inputMode="numeric"
                    aria-label={`موجودی ${product.name}، ${row.label}`}
                    value={row.onHand}
                    onChange={(event) =>
                      changeQuantity(
                        product.productId,
                        row.variantId,
                        event.target.value,
                      )
                    }
                  />
                </label>
              ))}
              <button
                className={styles.primaryButton}
                type="button"
                disabled={pendingId === product.productId}
                onClick={() => void save(product)}
              >
                {pendingId === product.productId ? "در حال ذخیره…" : "ذخیره موجودی"}
              </button>
            </section>
          ))}
        </div>
        <p className={styles.statusMessage} role="status">
          {message}
        </p>
      </section>
    </main>
  );
}
