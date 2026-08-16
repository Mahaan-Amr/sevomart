"use client";

import {
  mediaReferenceContract,
  type MediaId,
  type MediaReference,
} from "@sevo/contracts/media/v1";
import {
  storeDraftContract,
  storePreviewContract,
  storePublicationContract,
  type StoreDraft,
  type StoreDraftInput,
  type StorePreview,
} from "@sevo/contracts/store/v1";
import { useEffect, useState, type FormEvent } from "react";

import styles from "./store-builder.module.css";

type Stage = "edit" | "preview" | "published";
type FieldErrors = Partial<Record<"name" | "slug" | "bio" | "returnPolicy", string>>;
type ShippingCode = "NATIONAL_POST" | "COURIER" | "PICKUP";

const emptyForm: {
  name: string;
  slug: string;
  bio: string;
  shippingCode: ShippingCode;
  returnPolicy: string;
  themeColor: string;
} = {
  name: "",
  slug: "",
  bio: "",
  shippingCode: "NATIONAL_POST",
  returnPolicy: "",
  themeColor: "#A41439",
};

export function StoreBuilder() {
  const [form, setForm] = useState(emptyForm);
  const [stage, setStage] = useState<Stage>("edit");
  const [preview, setPreview] = useState<StorePreview>();
  const [logo, setLogo] = useState<File>();
  const [cover, setCover] = useState<File>();
  const [storedMedia, setStoredMedia] = useState<{
    logoMediaId: MediaId | null;
    coverMediaId: MediaId | null;
  }>({ logoMediaId: null, coverMediaId: null });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [publicUrl, setPublicUrl] = useState("");

  useEffect(() => {
    void loadDraft();
  }, []);

  async function loadDraft() {
    try {
      const response = await fetch("/api/store/seller/store/draft", {
        cache: "no-store",
      });
      if (response.status === 404) return;
      if (response.status === 401) {
        window.location.assign("/seller/login");
        return;
      }
      const body: unknown = await response.json();
      const parsed = storeDraftContract.safeParse(body);
      if (!response.ok || !parsed.success) throw new Error("draft unavailable");
      applyDraft(parsed.data);
    } catch {
      setMessage("اطلاعات فروشگاه بارگیری نشد. دوباره تلاش کنید.");
    } finally {
      setLoading(false);
    }
  }

  function applyDraft(draft: StoreDraft) {
    setForm({
      name: draft.name ?? "",
      slug: draft.slug ?? "",
      bio: draft.bio ?? "",
      shippingCode: draft.shippingMethods?.[0]?.code ?? "NATIONAL_POST",
      returnPolicy: draft.returnPolicy ?? "",
      themeColor: draft.themeColor ?? "#A41439",
    });
    setStoredMedia({
      logoMediaId: draft.logoMediaId ?? null,
      coverMediaId: draft.coverMediaId ?? null,
    });
    if (draft.status === "PUBLISHED") {
      setStage("published");
      setPublicUrl(`/s/${draft.slug}`);
    }
  }

  async function saveAndPreview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const localErrors = validateForm(form);
    setErrors(localErrors);
    if (Object.keys(localErrors).length > 0) return;
    setPending(true);
    setMessage("");
    try {
      const logoMediaId = logo ? (await uploadMedia(logo)).id : storedMedia.logoMediaId;
      const coverMediaId = cover
        ? (await uploadMedia(cover)).id
        : storedMedia.coverMediaId;
      const input: StoreDraftInput = {
        name: form.name.trim(),
        slug: form.slug.trim() as StoreDraftInput["slug"],
        bio: form.bio.trim(),
        shippingMethods: [shippingMethod(form.shippingCode)],
        returnPolicy: form.returnPolicy.trim(),
        settlementDestination: { kind: "TEST" },
        logoMediaId,
        coverMediaId,
        themeColor: form.themeColor,
      };
      const savedResponse = await fetch("/api/store/seller/store/draft", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      });
      const savedBody: unknown = await savedResponse.json();
      if (!savedResponse.ok) {
        setMessage(humanError(savedBody));
        setErrors(apiFieldErrors(savedBody));
        return;
      }
      if (!storeDraftContract.safeParse(savedBody).success) {
        throw new Error("invalid draft response");
      }
      setStoredMedia({ logoMediaId, coverMediaId });
      const previewResponse = await fetch("/api/store/seller/store/preview", {
        cache: "no-store",
      });
      const previewBody: unknown = await previewResponse.json();
      const parsedPreview = storePreviewContract.safeParse(previewBody);
      if (!previewResponse.ok || !parsedPreview.success) {
        throw new Error("invalid preview response");
      }
      setPreview(parsedPreview.data);
      setStage("preview");
      setMessage("پیش‌نویس ذخیره شد. حالا پیش‌نمایش را بررسی کنید.");
    } catch {
      setMessage("ذخیره فروشگاه انجام نشد. دوباره تلاش کنید.");
    } finally {
      setPending(false);
    }
  }

  async function publish() {
    setPending(true);
    setMessage("");
    try {
      const response = await fetch("/api/store/seller/store/publication", {
        method: "POST",
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        setMessage(humanError(body));
        return;
      }
      const parsed = storePublicationContract.safeParse(body);
      if (!parsed.success) throw new Error("invalid publication response");
      setPublicUrl(parsed.data.publicUrl);
      setStage("published");
      setMessage("فروشگاه منتشر شد. حالا می‌توانید لینک آن را به خریداران بدهید.");
    } catch {
      setMessage("انتشار فروشگاه انجام نشد. دوباره تلاش کنید.");
    } finally {
      setPending(false);
    }
  }

  if (loading) {
    return (
      <main className={styles.page} aria-busy="true">
        <p className={styles.loading}>در حال آماده‌کردن فروشگاه…</p>
      </main>
    );
  }

  if (stage === "published") {
    return (
      <main className={styles.page}>
        <section className={styles.panel} aria-labelledby="published-title">
          <span className={styles.brand}>سوو</span>
          <span className={styles.status}>منتشرشده</span>
          <h1 id="published-title">فروشگاه آماده است</h1>
          <p>{message || "لینک عمومی فروشگاه شما آمادهٔ اشتراک‌گذاری است."}</p>
          <code className={styles.publicLink} dir="ltr">
            {publicUrl}
          </code>
          <button className={styles.secondaryButton} onClick={() => setStage("edit")}>
            ویرایش فروشگاه
          </button>
        </section>
      </main>
    );
  }

  if (stage === "preview" && preview) {
    const draft = preview.store;
    return (
      <main className={styles.page}>
        <section className={styles.workspace} aria-labelledby="preview-title">
          <header className={styles.header}>
            <div>
              <span className={styles.status}>پیش‌نویس</span>
              <h1 id="preview-title">پیش‌نمایش فروشگاه</h1>
            </div>
            <button className={styles.secondaryButton} onClick={() => setStage("edit")}>
              برگشت و ویرایش
            </button>
          </header>
          <article
            className={styles.preview}
            style={{ "--store-color": draft.themeColor } as React.CSSProperties}
          >
            <div className={styles.cover}>
              {draft.coverMediaId ? (
                <img
                  src={`/api/store/media/${draft.coverMediaId}`}
                  alt="تصویر روی جلد"
                />
              ) : null}
            </div>
            <div className={styles.identity}>
              {draft.logoMediaId ? (
                <img src={`/api/store/media/${draft.logoMediaId}`} alt="نشان فروشگاه" />
              ) : (
                <span className={styles.logoFallback}>{draft.name?.slice(0, 1)}</span>
              )}
              <div>
                <h2>{draft.name}</h2>
                <p>{draft.bio}</p>
              </div>
            </div>
            <dl className={styles.trust}>
              <div>
                <dt>ارسال</dt>
                <dd>{draft.shippingMethods?.[0]?.label}</dd>
              </div>
              <div>
                <dt>مرجوعی</dt>
                <dd>{draft.returnPolicy}</dd>
              </div>
              <div>
                <dt>تسویه</dt>
                <dd>تأیید آزمایشی؛ بدون تضمین بازپرداخت</dd>
              </div>
            </dl>
            <footer>ساخته‌شده با سوو · اطلاعات اعتماد همیشه نمایش داده می‌شود</footer>
          </article>
          <p className={styles.message} role="status">
            {message}
          </p>
          <button className={styles.primaryButton} onClick={publish} disabled={pending}>
            {pending ? "در حال انتشار…" : "انتشار فروشگاه"}
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <section className={styles.workspace} aria-labelledby="store-title">
        <span className={styles.brand}>سوو</span>
        <span className={styles.status}>پیش‌نویس</span>
        <h1 id="store-title">ساخت فروشگاه</h1>
        <p>اطلاعاتی را وارد کنید که خریدار پیش از تصمیم‌گیری باید بداند.</p>
        <form className={styles.form} onSubmit={saveAndPreview} noValidate>
          <Field label="نام فروشگاه" error={errors.name}>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </Field>
          <Field
            label="شناسه لینک"
            hint="فقط حروف انگلیسی کوچک، عدد و خط تیره"
            error={errors.slug}
          >
            <div className={styles.slugInput}>
              <span dir="ltr">/s/</span>
              <input
                dir="ltr"
                value={form.slug}
                onChange={(e) => setForm({ ...form, slug: e.target.value })}
              />
            </div>
          </Field>
          <Field label="معرفی کوتاه" error={errors.bio}>
            <textarea
              value={form.bio}
              onChange={(e) => setForm({ ...form, bio: e.target.value })}
            />
          </Field>
          <Field label="روش ارسال">
            <select
              value={form.shippingCode}
              onChange={(e) =>
                setForm({
                  ...form,
                  shippingCode: e.target.value as typeof form.shippingCode,
                })
              }
            >
              <option value="NATIONAL_POST">پست پیشتاز</option>
              <option value="COURIER">پیک</option>
              <option value="PICKUP">دریافت حضوری</option>
            </select>
          </Field>
          <Field label="سیاست مرجوعی" error={errors.returnPolicy}>
            <textarea
              value={form.returnPolicy}
              onChange={(e) => setForm({ ...form, returnPolicy: e.target.value })}
            />
          </Field>
          <div className={styles.settlement}>
            <b>مقصد تسویه</b>
            <span>تأیید آزمایشی</span>
            <p>اطلاعات بانکی واقعی دریافت نمی‌شود و این وضعیت تضمین مالی نیست.</p>
          </div>
          <details className={styles.optional}>
            <summary>ظاهر فروشگاه (اختیاری)</summary>
            <Field label="رنگ فروشگاه">
              <input
                type="color"
                value={form.themeColor}
                onChange={(e) => setForm({ ...form, themeColor: e.target.value })}
              />
            </Field>
            <Field label="لوگو">
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(e) => setLogo(e.target.files?.[0])}
              />
            </Field>
            <Field label="تصویر روی جلد">
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(e) => setCover(e.target.files?.[0])}
              />
            </Field>
          </details>
          <p className={styles.message} role="alert" aria-live="polite">
            {message}
          </p>
          <button className={styles.primaryButton} type="submit" disabled={pending}>
            {pending ? "در حال ذخیره…" : "ذخیره و دیدن پیش‌نمایش"}
          </button>
        </form>
      </section>
    </main>
  );
}

function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={styles.field}>
      <span>{label}</span>
      {children}
      {hint ? <small>{hint}</small> : null}
      {error ? <small className={styles.error}>{error}</small> : null}
    </label>
  );
}

function validateForm(form: typeof emptyForm): FieldErrors {
  const errors: FieldErrors = {};
  if (form.name.trim().length < 2) errors.name = "نام فروشگاه را کامل‌تر بنویسید.";
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(form.slug) || form.slug.length < 3)
    errors.slug = "شناسه لینک باید دست‌کم سه نویسه و با قالب نمونه باشد.";
  if (form.bio.trim().length < 2) errors.bio = "یک معرفی کوتاه برای فروشگاه بنویسید.";
  if (form.returnPolicy.trim().length < 10)
    errors.returnPolicy = "شرایط مرجوعی را کمی روشن‌تر بنویسید.";
  return errors;
}

function shippingMethod(code: typeof emptyForm.shippingCode) {
  return {
    code,
    label:
      code === "NATIONAL_POST"
        ? "پست پیشتاز"
        : code === "COURIER"
          ? "پیک"
          : "دریافت حضوری",
  };
}

async function uploadMedia(file: File): Promise<MediaReference> {
  if (file.size > 5_500_000) throw new Error("media too large");
  const contentBase64 = await fileToBase64(file);
  const response = await fetch("/api/store/seller/media", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      fileName: file.name,
      contentType: file.type,
      contentBase64,
    }),
  });
  const body: unknown = await response.json();
  const parsed = mediaReferenceContract.safeParse(body);
  if (!response.ok || !parsed.success) throw new Error("media upload failed");
  return parsed.data;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.readAsDataURL(file);
  });
}

function humanError(body: unknown) {
  return typeof body === "object" &&
    body !== null &&
    "message" in body &&
    typeof body.message === "string"
    ? body.message
    : "درخواست انجام نشد. دوباره تلاش کنید.";
}
function apiFieldErrors(body: unknown): FieldErrors {
  if (typeof body !== "object" || body === null || !("details" in body)) return {};
  const details = body.details as { issues?: Array<{ field?: string }> };
  const result: FieldErrors = {};
  for (const issue of details.issues ?? [])
    if (issue.field && issue.field in emptyForm)
      result[issue.field as keyof FieldErrors] = "این بخش را بررسی کنید.";
  return result;
}
