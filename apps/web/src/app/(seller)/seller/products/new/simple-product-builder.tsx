"use client";

import {
  MEDIA_UPLOAD_ACCEPTED_TYPES,
  MEDIA_UPLOAD_MAX_BYTES,
  mediaReferenceContract,
  type MediaId,
} from "@sevo/contracts/media/v1";
import {
  publicSimpleProductContract,
  simpleProductPreviewContract,
  simpleProductViewContract,
  type PublicSimpleProduct,
} from "@sevo/contracts/product/v1";
import { storeDraftContract } from "@sevo/contracts/store/v1";
import { useEffect, useState } from "react";

import styles from "./simple-product-builder.module.css";

type Step = "details" | "image" | "sale" | "review" | "published";

export function SimpleProductBuilder() {
  const [step, setStep] = useState<Step>("details");
  const [productId, setProductId] = useState("");
  const [storeSlug, setStoreSlug] = useState("");
  const [revision, setRevision] = useState(0);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [image, setImage] = useState<File>();
  const [mediaId, setMediaId] = useState<MediaId>();
  const [priceToman, setPriceToman] = useState("");
  const [inventory, setInventory] = useState("");
  const [preview, setPreview] = useState<PublicSimpleProduct>();
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    void initialize();
  }, []);

  async function initialize() {
    try {
      const [createdResponse, storeResponse] = await Promise.all([
        fetch("/api/store/seller/products", {
          method: "POST",
          headers: writeHeaders(0),
          body: JSON.stringify({}),
        }),
        fetch("/api/store/seller/store/draft", { cache: "no-store" }),
      ]);
      if (createdResponse.status === 401 || storeResponse.status === 401) {
        window.location.assign("/seller/login?returnTo=%2Fseller%2Fproducts%2Fnew");
        return;
      }
      const created = simpleProductViewContract.safeParse(await createdResponse.json());
      const store = storeDraftContract.safeParse(await storeResponse.json());
      if (
        !createdResponse.ok ||
        !created.success ||
        !store.success ||
        !store.data.slug
      ) {
        throw new Error("Product builder initialization failed");
      }
      setProductId(created.data.productId);
      setRevision(created.data.revision);
      setStoreSlug(store.data.slug);
    } catch {
      setMessage("ساخت پیش‌نویس کالا انجام نشد. دوباره تلاش کنید.");
    } finally {
      setLoading(false);
    }
  }

  async function continueFromImage() {
    if (!image) {
      setMessage("یک تصویر برای کالا انتخاب کنید.");
      return;
    }
    setPending(true);
    setMessage("");
    try {
      const uploaded = await uploadProductImage(image);
      setMediaId(uploaded);
      setStep("sale");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "بارگذاری تصویر انجام نشد.");
    } finally {
      setPending(false);
    }
  }

  async function saveAndPreview() {
    const toman = Number(priceToman);
    const onHand = Number(inventory);
    if (!Number.isSafeInteger(toman) || toman <= 0) {
      setMessage("قیمت معتبر را به تومان وارد کنید.");
      return;
    }
    if (!Number.isInteger(onHand) || onHand < 0) {
      setMessage("موجودی باید عدد صحیح و نامنفی باشد.");
      return;
    }
    if (!mediaId) return;
    setPending(true);
    setMessage("");
    try {
      const savedResponse = await fetch(
        `/api/store/seller/products/${productId}/working-copy`,
        {
          method: "PUT",
          headers: writeHeaders(revision),
          body: JSON.stringify({
            expectedRevision: revision,
            workingCopy: {
              name: name.trim(),
              description: description.trim(),
              orderedMediaIds: [mediaId],
              variant: {
                clientKey: "simple",
                price: { amount: toman * 10, currency: "IRR" },
              },
            },
            inventory: { onHand, expectedRevision: 0 },
          }),
        },
      );
      const savedBody: unknown = await savedResponse.json();
      const saved = simpleProductViewContract.safeParse(savedBody);
      if (!savedResponse.ok || !saved.success || !saved.data.workingCopy) {
        throw new Error(humanError(savedBody, "ذخیره اطلاعات کالا انجام نشد."));
      }
      setRevision(saved.data.revision);
      const previewResponse = await fetch(
        `/api/store/seller/products/${productId}/preview`,
        { cache: "no-store" },
      );
      const productPreview = simpleProductPreviewContract.safeParse(
        await previewResponse.json(),
      );
      if (
        !previewResponse.ok ||
        !productPreview.success ||
        !productPreview.data.ready
      ) {
        throw new Error("پیش‌نمایش کالا آماده نیست.");
      }
      setPreview({
        productId: saved.data.productId,
        name: saved.data.workingCopy.name,
        description: saved.data.workingCopy.description,
        image: { id: mediaId, url: `/v1/media/${mediaId}` },
        price: saved.data.workingCopy.variant.price,
        availability: saved.data.inventory.onHand > 0 ? "AVAILABLE" : "OUT_OF_STOCK",
        publicationVersion: 1,
      });
      setStep("review");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "پیش‌نمایش آماده نشد.");
    } finally {
      setPending(false);
    }
  }

  async function publish() {
    setPending(true);
    setMessage("");
    try {
      const response = await fetch(
        `/api/store/seller/products/${productId}/publications`,
        {
          method: "POST",
          headers: writeHeaders(revision),
          body: JSON.stringify({ expectedRevision: revision, confirmed: true }),
        },
      );
      const published = publicSimpleProductContract.safeParse(await response.json());
      if (!response.ok || !published.success) {
        throw new Error("انتشار کالا انجام نشد. اطلاعات را دوباره بررسی کنید.");
      }
      setPreview(published.data);
      setStep("published");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "انتشار کالا انجام نشد.");
    } finally {
      setPending(false);
    }
  }

  if (loading) {
    return (
      <main className={styles.page} aria-busy="true">
        <p>در حال آماده‌کردن پیش‌نویس کالا…</p>
      </main>
    );
  }

  if (!productId) {
    return (
      <main className={styles.page}>
        <section className={styles.workspace} role="alert">
          <span className={styles.brand}>سوو</span>
          <h1>پیش‌نویس کالا آماده نشد</h1>
          <p>{message || "کمی بعد دوباره تلاش کنید."}</p>
          <button
            className={styles.primaryButton}
            onClick={() => window.location.reload()}
          >
            دوباره تلاش کنید
          </button>
        </section>
      </main>
    );
  }

  if (step === "published") {
    return (
      <main className={styles.page}>
        <section className={styles.workspace}>
          <span className={styles.brand}>سوو</span>
          <h1>کالا منتشر شد</h1>
          <p>خریدار حالا قیمت و وضعیت موجودی این کالا را در فروشگاه می‌بیند.</p>
          <a
            className={styles.primaryButton}
            href={`/s/${storeSlug}/products/${productId}`}
          >
            دیدن کالا در فروشگاه
          </a>
        </section>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <section className={styles.workspace} aria-live="polite">
        <header className={styles.header}>
          <span className={styles.brand}>سوو</span>
          <span className={styles.progress}>{stepLabel(step)} از ۴</span>
        </header>

        {step === "details" ? (
          <>
            <h1>مشخصات کالا</h1>
            <p>نام و توضیحی را بنویسید که خریدار برای شناخت کالا نیاز دارد.</p>
            <label className={styles.field}>
              <span>نام کالا</span>
              <input value={name} onChange={(event) => setName(event.target.value)} />
            </label>
            <label className={styles.field}>
              <span>توضیح کالا</span>
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </label>
            <button
              className={styles.primaryButton}
              disabled={name.trim().length < 2}
              onClick={() => setStep("image")}
            >
              ادامه
            </button>
          </>
        ) : null}

        {step === "image" ? (
          <>
            <h1>تصویر کالا</h1>
            <p>یک تصویر روشن انتخاب کنید؛ اصل فایل خصوصی می‌ماند.</p>
            <label className={styles.filePicker}>
              <span>تصویر کالا</span>
              <input
                type="file"
                accept={MEDIA_UPLOAD_ACCEPTED_TYPES.join(",")}
                onChange={(event) => setImage(event.target.files?.[0])}
              />
              <small>{image?.name ?? "تصویری انتخاب نشده است"}</small>
            </label>
            <div className={styles.actions}>
              <button
                className={styles.secondaryButton}
                onClick={() => setStep("details")}
              >
                برگشت
              </button>
              <button
                className={styles.primaryButton}
                disabled={pending}
                onClick={continueFromImage}
              >
                {pending ? "در حال بارگذاری…" : "ادامه"}
              </button>
            </div>
          </>
        ) : null}

        {step === "sale" ? (
          <>
            <h1>فروش کالا</h1>
            <p>قیمت را به تومان و موجودی واقعی را وارد کنید.</p>
            <label className={styles.field}>
              <span>قیمت به تومان</span>
              <input
                inputMode="numeric"
                value={priceToman}
                onChange={(event) => setPriceToman(event.target.value)}
              />
            </label>
            <label className={styles.field}>
              <span>موجودی</span>
              <input
                inputMode="numeric"
                value={inventory}
                onChange={(event) => setInventory(event.target.value)}
              />
            </label>
            <div className={styles.actions}>
              <button
                className={styles.secondaryButton}
                onClick={() => setStep("image")}
              >
                برگشت
              </button>
              <button
                className={styles.primaryButton}
                disabled={pending}
                onClick={saveAndPreview}
              >
                {pending ? "در حال ذخیره…" : "دیدن پیش‌نمایش"}
              </button>
            </div>
          </>
        ) : null}

        {step === "review" && preview ? (
          <>
            <h1>بازبینی کالا</h1>
            <ProductPreview product={preview} />
            <div className={styles.actions}>
              <button
                className={styles.secondaryButton}
                onClick={() => setStep("sale")}
              >
                برگشت و ویرایش
              </button>
              <button
                className={styles.primaryButton}
                disabled={pending}
                onClick={publish}
              >
                {pending ? "در حال انتشار…" : "انتشار کالا"}
              </button>
            </div>
          </>
        ) : null}

        <p className={styles.message} role="alert">
          {message}
        </p>
      </section>
    </main>
  );
}

function ProductPreview({ product }: { product: PublicSimpleProduct }) {
  return (
    <article className={styles.preview}>
      <img src={`/api/store/media/${product.image.id}`} alt={product.name} />
      <div>
        <h2>{product.name}</h2>
        <p>{product.description}</p>
        <strong>{formatToman(product.price.amount)}</strong>
        <span className={styles.availability}>
          {product.availability === "AVAILABLE" ? "موجود" : "ناموجود"}
        </span>
      </div>
    </article>
  );
}

async function uploadProductImage(file: File): Promise<MediaId> {
  if (file.size > MEDIA_UPLOAD_MAX_BYTES) {
    throw new Error("حجم تصویر باید حداکثر ۱۰ مگابایت باشد.");
  }
  if (!(MEDIA_UPLOAD_ACCEPTED_TYPES as readonly string[]).includes(file.type)) {
    throw new Error("فقط تصویر JPEG، PNG یا WebP پذیرفته می‌شود.");
  }
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
    throw new Error(
      typeof body === "object" &&
        body !== null &&
        "message" in body &&
        typeof body.message === "string"
        ? body.message
        : "بارگذاری تصویر انجام نشد.",
    );
  }
  return parsed.data.id;
}

function writeHeaders(revision: number) {
  return {
    "content-type": "application/json",
    "idempotency-key": crypto.randomUUID(),
    "if-match": `"${revision}"`,
  };
}

function formatToman(amount: number) {
  return `${new Intl.NumberFormat("fa-IR").format(amount / 10)} تومان`;
}

function stepLabel(step: Step) {
  return step === "details"
    ? "۱"
    : step === "image"
      ? "۲"
      : step === "sale"
        ? "۳"
        : "۴";
}

function humanError(body: unknown, fallback: string) {
  return typeof body === "object" &&
    body !== null &&
    "message" in body &&
    typeof body.message === "string"
    ? body.message
    : fallback;
}
