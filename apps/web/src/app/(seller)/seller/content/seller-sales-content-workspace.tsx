"use client";

import {
  sellerSalesContentItemV2Contract,
  sellerSalesContentListV2Contract,
  type SellerSalesContentItemV2,
} from "@sevo/contracts/content/v2";
import {
  MEDIA_UPLOAD_ACCEPTED_TYPES,
  mediaReferenceContract,
} from "@sevo/contracts/media/v1";
import {
  sellerProductListContract,
  type SellerProductSummary,
} from "@sevo/contracts/product/v1";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  activeProductOptions,
  contentPurchaseMessage,
  sellerContentError,
  validateContentImage,
  validateSalesContentDraft,
} from "./seller-sales-content-model";
import styles from "./seller-sales-content.module.css";

type Mode = "list" | "create" | "edit";

export function SellerSalesContentWorkspace({
  mode,
  contentId,
}: {
  mode: Mode;
  contentId?: string;
}) {
  const [items, setItems] = useState<SellerSalesContentItemV2[]>([]);
  const [products, setProducts] = useState<SellerProductSummary[]>([]);
  const [storeId, setStoreId] = useState("");
  const [current, setCurrent] = useState<SellerSalesContentItemV2>();
  const [selected, setSelected] = useState<string[]>([]);
  const [mediaId, setMediaId] = useState<string>();
  const [previewUrl, setPreviewUrl] = useState<string>();
  const [message, setMessage] = useState("در حال بارگیری…");
  const [failed, setFailed] = useState(false);
  const [pending, setPending] = useState(false);
  const mutation = useRef<{ payload: string; key: string } | undefined>(undefined);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();

    async function load(signal: AbortSignal) {
      try {
        const [listResponse, productResponse, itemResponse] = await Promise.all([
          fetch("/api/seller/sales-content", { cache: "no-store", signal }),
          fetch("/api/store/seller/products?limit=50&state=PUBLISHED", {
            cache: "no-store",
            signal,
          }),
          mode === "edit" && contentId
            ? fetch(`/api/seller/sales-content/${contentId}`, {
                cache: "no-store",
                signal,
              })
            : Promise.resolve(undefined),
        ]);
        const listBody: unknown = await listResponse.json();
        const productBody: unknown = await productResponse.json();
        const parsedList = sellerSalesContentListV2Contract.safeParse(listBody);
        const parsedProducts = sellerProductListContract.safeParse(productBody);
        if (!listResponse.ok || !parsedList.success) {
          throw new Error(sellerContentError(listBody, "محتواها بارگیری نشدند."));
        }
        if (!productResponse.ok || !parsedProducts.success) {
          throw new Error(sellerContentError(productBody, "کالاها بارگیری نشدند."));
        }
        setItems(parsedList.data.items);
        setStoreId(parsedList.data.storeId);
        setProducts(parsedProducts.data.items);
        if (itemResponse) {
          const itemBody: unknown = await itemResponse.json();
          const parsedItem = sellerSalesContentItemV2Contract.safeParse(itemBody);
          if (!itemResponse.ok || !parsedItem.success) {
            throw new Error(sellerContentError(itemBody, "محتوا پیدا نشد."));
          }
          setCurrent(parsedItem.data);
          setMediaId(parsedItem.data.media.mediaId);
          setSelected(parsedItem.data.products.map((product) => product.productId));
          setPreviewUrl(`/api/store/media/${parsedItem.data.media.mediaId}`);
        }
        setFailed(false);
        setMessage("");
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setFailed(true);
          setMessage(error instanceof Error ? error.message : "بارگیری انجام نشد.");
        }
      }
    }
  }, [contentId, mode]);

  const activeProducts = useMemo(() => activeProductOptions(products), [products]);
  const productNames = useMemo(
    () => new Map(products.map((product) => [product.productId, product.name])),
    [products],
  );
  const inactiveSelections = useMemo(
    () =>
      current?.products.filter(
        (product) => !product.active && selected.includes(product.productId),
      ) ?? [],
    [current, selected],
  );
  const hasSelectedActiveProduct = activeProducts.some((product) =>
    selected.includes(product.productId),
  );

  async function chooseImage(file?: File) {
    if (!file) return;
    const issue = validateContentImage(file);
    if (issue) {
      setFailed(true);
      setMessage(issue);
      return;
    }
    setPending(true);
    setFailed(false);
    setMessage("تصویر در حال بارگذاری است…");
    try {
      const form = new FormData();
      form.set("purpose", "PRODUCT_IMAGE");
      form.set("file", file, file.name);
      const response = await fetch("/api/store/seller/media", {
        method: "POST",
        body: form,
      });
      const body: unknown = await response.json();
      const parsed = mediaReferenceContract.safeParse(body);
      if (!response.ok || !parsed.success) {
        throw new Error(sellerContentError(body, "بارگذاری تصویر انجام نشد."));
      }
      if (previewUrl?.startsWith("blob:")) URL.revokeObjectURL(previewUrl);
      setMediaId(parsed.data.id);
      setPreviewUrl(URL.createObjectURL(file));
      setMessage("تصویر آماده است.");
    } catch (error) {
      setFailed(true);
      setMessage(error instanceof Error ? error.message : "بارگذاری تصویر انجام نشد.");
    } finally {
      setPending(false);
    }
  }

  function toggleProduct(productId: string) {
    setSelected((value) =>
      value.includes(productId)
        ? value.filter((candidate) => candidate !== productId)
        : [...value, productId],
    );
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const problem = validateSalesContentDraft({ mediaId, productIds: selected });
    if (problem) {
      setFailed(true);
      setMessage(problem);
      return;
    }
    const body =
      mode === "edit" && current
        ? {
            expectedRevision: current.revision,
            media: { mediaId, kind: "IMAGE" as const },
            productIds: selected,
          }
        : {
            storeId,
            media: { mediaId, kind: "IMAGE" as const },
            productIds: selected,
          };
    const payload = JSON.stringify(body);
    if (mutation.current?.payload !== payload) {
      mutation.current = { payload, key: crypto.randomUUID() };
    }
    setPending(true);
    setFailed(false);
    setMessage(
      mode === "edit" ? "تغییرها در حال ثبت است…" : "محتوا در حال انتشار است…",
    );
    try {
      const response = await fetch(
        mode === "edit"
          ? `/api/seller/sales-content/${contentId}`
          : "/api/seller/sales-content",
        {
          method: mode === "edit" ? "PUT" : "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": mutation.current.key,
          },
          body: payload,
        },
      );
      const responseBody: unknown = await response.json();
      if (!response.ok) {
        throw new Error(sellerContentError(responseBody, "ثبت محتوا انجام نشد."));
      }
      window.location.assign("/seller/content");
    } catch (error) {
      setFailed(true);
      setMessage(error instanceof Error ? error.message : "ثبت محتوا انجام نشد.");
      setPending(false);
    }
  }

  if (failed && (!storeId || (mode === "edit" && !current))) {
    return <LoadFailure message={message} />;
  }
  if (!storeId || (mode === "edit" && !current)) {
    return <p role="status">{message}</p>;
  }
  if (mode === "list") {
    return (
      <section className={styles.list} aria-labelledby="seller-content-list-title">
        <div className={styles.headingRow}>
          <div>
            <span className={styles.eyebrow}>محتوای فروش</span>
            <h1 id="seller-content-list-title">محتوای فروشگاه</h1>
            <p>تصویر و کالاهای مرتبط را کنار هم منتشر و ویرایش کنید.</p>
          </div>
          <Link className={styles.primary} href="/seller/content/new">
            ساخت محتوای تازه
          </Link>
        </div>
        {items.length ? (
          <ul className={styles.contentList} aria-label="فهرست محتوای فروش">
            {items.map((item) => (
              <li key={item.contentId}>
                <img src={`/api/store/media/${item.media.mediaId}`} alt="" />
                <div className={styles.itemText}>
                  <strong>منبع: فروشنده</strong>
                  <ul className={styles.productStates}>
                    {item.products.map((product) => (
                      <li key={product.productId}>
                        <span>
                          {productNames.get(product.productId) ?? "کالای پیوندشده"}
                        </span>
                        <span
                          className={product.active ? styles.active : styles.inactive}
                        >
                          {product.active
                            ? "فعال برای خرید"
                            : "متوقف و غیرفعال برای خرید"}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <span className={item.active ? styles.active : styles.inactive}>
                    {contentPurchaseMessage(item.active)}
                  </span>
                </div>
                <Link
                  className={styles.secondary}
                  href={`/seller/content/${item.contentId}`}
                >
                  ویرایش محتوا
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.empty}>هنوز محتوای فروشی منتشر نکرده‌اید.</p>
        )}
      </section>
    );
  }

  return (
    <section className={styles.editor} aria-labelledby="seller-content-editor-title">
      <span className={styles.eyebrow}>منبع: فروشنده</span>
      <h1 id="seller-content-editor-title">
        {mode === "edit" ? "ویرایش محتوای فروش" : "ساخت محتوای فروش"}
      </h1>
      <p>یک تصویر و بین یک تا ده کالای فعال انتخاب کنید.</p>
      <form onSubmit={submit} noValidate>
        <fieldset disabled={pending}>
          <legend>تصویر محتوا</legend>
          {previewUrl ? (
            <img
              className={styles.preview}
              src={previewUrl}
              alt="پیش‌نمایش تصویر محتوا"
            />
          ) : null}
          <label className={styles.fileButton}>
            {previewUrl ? "جایگزینی تصویر" : "انتخاب تصویر"}
            <input
              type="file"
              accept={MEDIA_UPLOAD_ACCEPTED_TYPES.join(",")}
              onChange={(event) => void chooseImage(event.target.files?.[0])}
            />
          </label>
          <small>JPEG، PNG یا WebP تا ۱۰ مگابایت. ویدیو هنوز پشتیبانی نمی‌شود.</small>
        </fieldset>
        <fieldset disabled={pending}>
          <legend>کالاهای مرتبط ({selected.length} از ۱۰)</legend>
          {activeProducts.length || inactiveSelections.length ? (
            <div className={styles.productChoices}>
              {activeProducts.map((product) => (
                <label key={product.productId}>
                  <input
                    type="checkbox"
                    checked={selected.includes(product.productId)}
                    onChange={() => toggleProduct(product.productId)}
                    disabled={
                      pending ||
                      (!selected.includes(product.productId) && selected.length >= 10)
                    }
                  />
                  <span>{product.name ?? "کالای بدون نام"}</span>
                </label>
              ))}
              {inactiveSelections.map((product) => (
                <label className={styles.stoppedChoice} key={product.productId}>
                  <input
                    type="checkbox"
                    checked
                    onChange={() => toggleProduct(product.productId)}
                    disabled={pending}
                  />
                  <span>کالای متوقف‌شده — برای حذف پیوند، تیک را بردارید</span>
                </label>
              ))}
            </div>
          ) : null}
          {!activeProducts.length ? (
            <p>
              برای ساخت محتوا ابتدا یک کالا را منتشر کنید.{" "}
              <Link href="/seller/products/new">ساخت کالا</Link>
            </p>
          ) : null}
        </fieldset>
        {message ? <p role={failed ? "alert" : "status"}>{message}</p> : null}
        <div className={styles.actions}>
          <button
            className={styles.primary}
            type="submit"
            disabled={pending || !hasSelectedActiveProduct}
          >
            {pending ? "در حال ثبت…" : mode === "edit" ? "ثبت تغییرها" : "انتشار محتوا"}
          </button>
          <Link className={styles.secondary} href="/seller/content">
            بازگشت به فهرست
          </Link>
          {failed && message.includes("تازه کنید") ? (
            <button
              className={styles.textButton}
              type="button"
              onClick={() => window.location.reload()}
            >
              تازه‌کردن صفحه
            </button>
          ) : null}
        </div>
      </form>
    </section>
  );
}

function LoadFailure({ message }: { message: string }) {
  return (
    <div className={styles.failure} role="alert">
      <p>{message}</p>
      <button type="button" onClick={() => window.location.reload()}>
        تلاش دوباره
      </button>
    </div>
  );
}
