"use client";

import {
  MEDIA_UPLOAD_ACCEPTED_TYPES,
  MEDIA_UPLOAD_MAX_BYTES,
  MEDIA_UPLOAD_MAX_PIXELS,
  mediaReferenceContract,
  type MediaId,
  type MediaReference,
} from "@sevo/contracts/media/v1";
import {
  storeDraftContract,
  storePreviewContract,
  storePublicationContract,
  slugAvailabilityContract,
  type StoreDraft,
  type StoreDraftInput,
  type StorePreview,
} from "@sevo/contracts/store/v1";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import styles from "./store-builder.module.css";
import { readableStoreForeground } from "./store-color";

type Stage = "edit" | "preview" | "published";
export type StoreSection = "setup" | "profile" | "shipping" | "returns" | "appearance";
type FieldErrors = Partial<
  Record<
    "name" | "slug" | "bio" | "shipping" | "returnPolicy" | "logo" | "cover",
    string
  >
>;
type ShippingCode = "NATIONAL_POST" | "COURIER" | "PICKUP";
type ShippingForm = {
  code: ShippingCode;
  label: string;
  feeToman: string;
  estimatedDeliveryText: string;
  enabled: boolean;
};

const emptyForm: {
  name: string;
  slug: string;
  bio: string;
  shippingCode: ShippingCode;
  returnPolicy: string;
  themeColor: string;
  shippingMethods: ShippingForm[];
} = {
  name: "",
  slug: "",
  bio: "",
  shippingCode: "NATIONAL_POST",
  returnPolicy: "",
  themeColor: "#A41439",
  shippingMethods: [defaultShippingMethod("NATIONAL_POST")],
};

export function StoreBuilder({ section = "setup" }: { section?: StoreSection }) {
  const [form, setForm] = useState(emptyForm);
  const [stage, setStage] = useState<Stage>("edit");
  const [editStep, setEditStep] = useState(0);
  const [preview, setPreview] = useState<StorePreview>();
  const [logo, setLogo] = useState<File>();
  const [cover, setCover] = useState<File>();
  const [logoPreviewUrl, setLogoPreviewUrl] = useState("");
  const [coverPreviewUrl, setCoverPreviewUrl] = useState("");
  const [storedMedia, setStoredMedia] = useState<{
    logoMediaId: MediaId | null;
    coverMediaId: MediaId | null;
  }>({ logoMediaId: null, coverMediaId: null });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [publicUrl, setPublicUrl] = useState("");
  const [revision, setRevision] = useState(0);
  const [slugStatus, setSlugStatus] = useState("");
  const [slugUnavailable, setSlugUnavailable] = useState(false);
  const slugCheckSequence = useRef(0);

  useEffect(() => {
    void loadDraft();
  }, []);

  useEffect(() => {
    if (!logo) {
      setLogoPreviewUrl("");
      return;
    }
    const url = URL.createObjectURL(logo);
    setLogoPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [logo]);

  useEffect(() => {
    if (!cover) {
      setCoverPreviewUrl("");
      return;
    }
    const url = URL.createObjectURL(cover);
    setCoverPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [cover]);

  async function loadDraft() {
    try {
      const response = await fetch("/api/store/seller/store/draft", {
        cache: "no-store",
      });
      if (response.status === 404) return;
      if (response.status === 401) {
        window.location.assign("/seller/login?returnTo=%2Fseller%2Fstore");
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
    setRevision(draft.revision);
    setForm({
      name: draft.name ?? "",
      slug: draft.slug ?? "",
      bio: draft.bio ?? "",
      shippingCode: draft.shippingMethods?.[0]?.code ?? "NATIONAL_POST",
      returnPolicy: draft.returnPolicy ?? "",
      themeColor: draft.themeColor ?? "#A41439",
      shippingMethods: draft.shippingMethods?.map((method) => ({
        code: method.code,
        label: method.label,
        feeToman: String(method.fixedFee.amount / 10),
        estimatedDeliveryText: method.estimatedDeliveryText,
        enabled: method.enabled,
      })) ?? [defaultShippingMethod("NATIONAL_POST")],
    });
    setStoredMedia({
      logoMediaId: draft.logoMediaId ?? null,
      coverMediaId: draft.coverMediaId ?? null,
    });
    if (draft.status === "PUBLISHED" && section === "setup") {
      setStage("published");
      setPublicUrl(`/s/${draft.slug}`);
    }
  }

  function updateFormField<K extends keyof typeof emptyForm>(
    field: K,
    value: (typeof emptyForm)[K],
  ) {
    setForm((current) => ({ ...current, [field]: value }));
    if (field === "slug") {
      slugCheckSequence.current += 1;
      setSlugUnavailable(false);
      setSlugStatus("");
    }
    setErrors((current) => {
      if (!(field in current)) return current;
      const next = { ...current };
      delete next[field as keyof FieldErrors];
      return next;
    });
  }

  async function saveAndPreview() {
    const localErrors = validateForm(form);
    if (slugUnavailable) localErrors.slug = "این شناسه لینک قبلاً استفاده شده است.";
    setErrors(localErrors);
    if (Object.keys(localErrors).length > 0) {
      setEditStep(localErrors.returnPolicy && !hasIdentityErrors(localErrors) ? 1 : 0);
      return;
    }
    setPending(true);
    setMessage("");
    try {
      const media = await resolveDraftMedia();
      const input = buildDraftInput(form, media, true);
      const { logoMediaId, coverMediaId } = media;
      await persistDraft(input, logoMediaId, coverMediaId);
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
    } catch (error) {
      if (error instanceof MediaUploadError) {
        setErrors((current) => ({ ...current, [error.field]: error.message }));
        setMessage("");
        return;
      }
      setMessage(
        error instanceof StoreDraftSaveError
          ? error.message
          : "ذخیره فروشگاه انجام نشد. دوباره تلاش کنید.",
      );
    } finally {
      setPending(false);
    }
  }

  async function saveAndExit() {
    setPending(true);
    setMessage("");
    try {
      const media = await resolveDraftMedia();
      const input = buildDraftInput(form, media, false);
      const { logoMediaId, coverMediaId } = media;
      await persistDraft(input, logoMediaId, coverMediaId);
      window.location.assign("/seller/store");
    } catch (error) {
      if (error instanceof MediaUploadError) {
        setErrors((current) => ({ ...current, [error.field]: error.message }));
        setMessage("");
        return;
      }
      setMessage("ذخیره فروشگاه انجام نشد. دوباره تلاش کنید.");
    } finally {
      setPending(false);
    }
  }

  async function saveSectionAndExit() {
    if (section === "setup") return;
    const localErrors = validateSection(section, form);
    if (section === "profile" && slugUnavailable) {
      localErrors.slug = "این شناسه لینک قبلاً استفاده شده است.";
    }
    setErrors(localErrors);
    if (Object.keys(localErrors).length > 0) return;
    setPending(true);
    setMessage("");
    try {
      const media = section === "appearance" ? await resolveDraftMedia() : storedMedia;
      await persistDraft(
        buildSectionInput(section, form, media),
        media.logoMediaId,
        media.coverMediaId,
      );
      window.location.assign("/seller/store");
    } catch (error) {
      if (error instanceof MediaUploadError) {
        setErrors((current) => ({ ...current, [error.field]: error.message }));
        setMessage("");
        return;
      }
      setMessage(
        error instanceof StoreDraftSaveError
          ? error.message
          : "ذخیره فروشگاه انجام نشد. دوباره تلاش کنید.",
      );
    } finally {
      setPending(false);
    }
  }

  async function resolveDraftMedia(): Promise<DraftMedia> {
    return {
      logoMediaId: logo
        ? (await uploadMedia(logo, "STORE_LOGO")).id
        : storedMedia.logoMediaId,
      coverMediaId: cover
        ? (await uploadMedia(cover, "STORE_COVER")).id
        : storedMedia.coverMediaId,
    };
  }

  async function checkSlug() {
    const slug = form.slug.trim();
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length < 3) return;
    const sequence = ++slugCheckSequence.current;
    setSlugStatus("در حال بررسی شناسه لینک…");
    try {
      const response = await fetch(
        `/api/store/store-slugs/${encodeURIComponent(slug)}/availability`,
        { cache: "no-store" },
      );
      const parsed = slugAvailabilityContract.safeParse(await response.json());
      if (!response.ok || !parsed.success) throw new Error("slug unavailable");
      if (sequence !== slugCheckSequence.current) return;
      setSlugUnavailable(!parsed.data.available);
      setSlugStatus(
        parsed.data.available
          ? "این شناسه لینک در دسترس است."
          : "این شناسه لینک قبلاً استفاده شده است.",
      );
      setErrors((current) => ({
        ...current,
        slug: parsed.data.available
          ? undefined
          : "این شناسه لینک قبلاً استفاده شده است.",
      }));
    } catch {
      if (sequence !== slugCheckSequence.current) return;
      setSlugStatus("بررسی شناسه لینک انجام نشد؛ هنگام ذخیره دوباره بررسی می‌شود.");
    }
  }

  function continueSetup() {
    const allErrors = validateForm(form);
    const stepErrors: FieldErrors =
      editStep === 0
        ? {
            ...(allErrors.name ? { name: allErrors.name } : {}),
            ...(allErrors.slug ? { slug: allErrors.slug } : {}),
            ...(allErrors.bio ? { bio: allErrors.bio } : {}),
          }
        : allErrors.returnPolicy
          ? { returnPolicy: allErrors.returnPolicy }
          : {};
    setErrors(stepErrors);
    if (Object.keys(stepErrors).length === 0) setEditStep((current) => current + 1);
  }

  async function persistDraft(
    input: StoreDraftInput,
    logoMediaId: MediaId | null,
    coverMediaId: MediaId | null,
  ) {
    const response = await fetch("/api/store/seller/store/draft", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        "idempotency-key": crypto.randomUUID(),
        "if-match": `"${revision}"`,
      },
      body: JSON.stringify(input),
    });
    const body: unknown = await response.json();
    if (!response.ok) {
      setMessage(humanError(body));
      setErrors(apiFieldErrors(body));
      throw new StoreDraftSaveError(humanError(body));
    }
    const parsed = storeDraftContract.safeParse(body);
    if (!parsed.success) throw new Error("invalid draft response");
    setRevision(parsed.data.revision);
    setStoredMedia({ logoMediaId, coverMediaId });
    return parsed.data;
  }

  async function publish() {
    setPending(true);
    setMessage("");
    try {
      const response = await fetch("/api/store/seller/store/publication", {
        method: "POST",
        headers: {
          "idempotency-key": crypto.randomUUID(),
          "if-match": `"${revision}"`,
        },
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        setMessage(publicationError(body));
        return;
      }
      const parsed = storePublicationContract.safeParse(body);
      if (!parsed.success) throw new Error("invalid publication response");
      setRevision(parsed.data.store.revision);
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

  if (section !== "setup") {
    return (
      <StoreSettingsPage
        section={section}
        form={form}
        errors={errors}
        message={message}
        pending={pending}
        logo={logo}
        cover={cover}
        logoPreviewUrl={logoPreviewUrl}
        coverPreviewUrl={coverPreviewUrl}
        storedMedia={storedMedia}
        updateFormField={updateFormField}
        setLogo={(file) => {
          setLogo(file);
          setErrors((current) => ({ ...current, logo: undefined }));
        }}
        setCover={(file) => {
          setCover(file);
          setErrors((current) => ({ ...current, cover: undefined }));
        }}
        saveAndExit={() => void saveSectionAndExit()}
        onSlugBlur={() => void checkSlug()}
        slugStatus={slugStatus}
      />
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
    const themeColor = draft.themeColor ?? "#A41439";
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
            style={
              {
                "--store-color": themeColor,
                "--store-foreground": readableStoreForeground(themeColor),
              } as React.CSSProperties
            }
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
        <div className={styles.focusHeader}>
          <Link className={styles.backLink} href="/seller/store">
            بازگشت به وضعیت فروشگاه
          </Link>
          <span className={styles.progress}>
            قدم {(editStep + 1).toLocaleString("fa-IR")} از ۳
          </span>
        </div>
        <span className={styles.brand}>سوو</span>
        <span className={styles.status}>پیش‌نویس</span>
        <h1 id="store-title">ساخت فروشگاه</h1>
        <p>اطلاعاتی را وارد کنید که خریدار پیش از تصمیم‌گیری باید بداند.</p>
        <form
          className={styles.form}
          onSubmit={(event) => event.preventDefault()}
          noValidate
        >
          {editStep === 0 ? (
            <>
              <h2>معرفی فروشگاه</h2>
              <Field label="نام فروشگاه" error={errors.name}>
                <input
                  value={form.name}
                  onChange={(e) => updateFormField("name", e.target.value)}
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
                    onChange={(e) => updateFormField("slug", e.target.value)}
                    onBlur={() => void checkSlug()}
                  />
                </div>
              </Field>
              <Field label="معرفی کوتاه" error={errors.bio}>
                <textarea
                  value={form.bio}
                  onChange={(e) => updateFormField("bio", e.target.value)}
                />
              </Field>
            </>
          ) : null}
          {editStep === 1 ? (
            <>
              <h2>ارسال و مرجوعی</h2>
              <Field label="روش ارسال">
                <select
                  value={form.shippingCode}
                  onChange={(e) =>
                    setForm((current) => {
                      const code = e.target.value as typeof form.shippingCode;
                      const selected =
                        current.shippingMethods.find(
                          (method) => method.code === code,
                        ) ?? defaultShippingMethod(code);
                      return {
                        ...current,
                        shippingCode: code,
                        shippingMethods: [
                          selected,
                          ...current.shippingMethods
                            .slice(1)
                            .filter((method) => method.code !== code),
                        ],
                      };
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
                  onChange={(e) => updateFormField("returnPolicy", e.target.value)}
                />
              </Field>
              <div className={styles.settlement}>
                <b>مقصد تسویه</b>
                <span>تأیید آزمایشی</span>
                <p>اطلاعات بانکی واقعی دریافت نمی‌شود و این وضعیت تضمین مالی نیست.</p>
              </div>
            </>
          ) : null}
          {editStep === 2 ? (
            <>
              <h2>ظاهر فروشگاه</h2>
              <p>این بخش اختیاری است و بعداً هم می‌توانید آن را تغییر دهید.</p>
              <article
                className={styles.livePreview}
                aria-label="پیش‌نمایش زنده فروشگاه"
              >
                <div
                  className={styles.liveCover}
                  style={{ backgroundColor: form.themeColor }}
                >
                  {coverPreviewUrl || storedMedia.coverMediaId ? (
                    <img
                      src={
                        coverPreviewUrl ||
                        `/api/store/media/${storedMedia.coverMediaId}`
                      }
                      alt="پیش‌نمایش تصویر روی جلد"
                    />
                  ) : null}
                </div>
                <div className={styles.liveIdentity}>
                  {logoPreviewUrl || storedMedia.logoMediaId ? (
                    <img
                      src={
                        logoPreviewUrl || `/api/store/media/${storedMedia.logoMediaId}`
                      }
                      alt="پیش‌نمایش لوگو"
                    />
                  ) : (
                    <span
                      className={styles.liveLogo}
                      style={{
                        backgroundColor: form.themeColor,
                        color: readableStoreForeground(form.themeColor),
                      }}
                    >
                      {form.name.trim().slice(0, 1) || "س"}
                    </span>
                  )}
                  <div>
                    <strong>{form.name.trim() || "نام فروشگاه"}</strong>
                    <p>{form.bio.trim() || "معرفی کوتاه فروشگاه"}</p>
                  </div>
                </div>
              </article>
              <Field label="رنگ فروشگاه">
                <input
                  type="color"
                  value={form.themeColor}
                  onChange={(e) => updateFormField("themeColor", e.target.value)}
                />
              </Field>
              <Field label="لوگو" error={errors.logo}>
                <FilePicker
                  label="لوگو"
                  file={logo}
                  onChange={(file) => {
                    setLogo(file);
                    setErrors((current) => ({ ...current, logo: undefined }));
                  }}
                />
              </Field>
              <Field label="تصویر روی جلد" error={errors.cover}>
                <FilePicker
                  label="تصویر روی جلد"
                  file={cover}
                  onChange={(file) => {
                    setCover(file);
                    setErrors((current) => ({ ...current, cover: undefined }));
                  }}
                />
              </Field>
            </>
          ) : null}
          <p className={styles.message} role="alert" aria-live="polite">
            {message}
          </p>
          {editStep < 2 ? (
            <button
              className={styles.primaryButton}
              type="button"
              disabled={pending}
              onClick={continueSetup}
            >
              ادامه
            </button>
          ) : (
            <button
              className={styles.primaryButton}
              type="button"
              disabled={pending}
              onClick={() => void saveAndPreview()}
            >
              {pending ? "در حال ذخیره…" : "ذخیره و دیدن پیش‌نمایش"}
            </button>
          )}
          {editStep > 0 ? (
            <button
              className={styles.secondaryButton}
              type="button"
              disabled={pending}
              onClick={() => setEditStep((current) => current - 1)}
            >
              بازگشت
            </button>
          ) : null}
          <button
            className={styles.secondaryButton}
            type="button"
            disabled={pending}
            onClick={saveAndExit}
          >
            ذخیره و خروج
          </button>
        </form>
      </section>
    </main>
  );
}

type DraftMedia = {
  logoMediaId: MediaId | null;
  coverMediaId: MediaId | null;
};

type StoreForm = typeof emptyForm;

function StoreSettingsPage({
  section,
  form,
  errors,
  message,
  pending,
  logo,
  cover,
  logoPreviewUrl,
  coverPreviewUrl,
  storedMedia,
  updateFormField,
  setLogo,
  setCover,
  saveAndExit,
  onSlugBlur,
  slugStatus,
}: {
  section: Exclude<StoreSection, "setup">;
  form: StoreForm;
  errors: FieldErrors;
  message: string;
  pending: boolean;
  logo?: File;
  cover?: File;
  logoPreviewUrl: string;
  coverPreviewUrl: string;
  storedMedia: DraftMedia;
  updateFormField: <K extends keyof StoreForm>(field: K, value: StoreForm[K]) => void;
  setLogo: (file?: File) => void;
  setCover: (file?: File) => void;
  saveAndExit: () => void;
  onSlugBlur: () => void;
  slugStatus: string;
}) {
  const title = {
    profile: "معرفی فروشگاه",
    shipping: "روش‌های ارسال",
    returns: "شرایط مرجوعی",
    appearance: "ظاهر فروشگاه",
  }[section];

  function updateShipping(code: ShippingCode, update: Partial<ShippingForm>) {
    const current =
      form.shippingMethods.find((method) => method.code === code) ??
      defaultShippingMethod(code);
    const next = form.shippingMethods.filter((method) => method.code !== code);
    const updated = { ...current, ...update };
    if (
      updated.enabled ||
      form.shippingMethods.some((method) => method.code === code)
    ) {
      next.push(updated);
    }
    updateFormField(
      "shippingMethods",
      shippingCodes.flatMap((knownCode) => {
        const method = next.find((item) => item.code === knownCode);
        return method ? [method] : [];
      }),
    );
  }

  return (
    <main className={styles.page}>
      <section className={styles.workspace} aria-labelledby="settings-title">
        <div className={styles.focusHeader}>
          <Link className={styles.backLink} href="/seller/store">
            بازگشت به وضعیت فروشگاه
          </Link>
          <span className={styles.status}>تنظیمات فروشگاه</span>
        </div>
        <h1 id="settings-title">{title}</h1>
        <p>{sectionDescription(section)}</p>
        <form
          className={styles.form}
          onSubmit={(event) => event.preventDefault()}
          noValidate
        >
          {section === "profile" ? (
            <>
              <Field label="نام فروشگاه" error={errors.name}>
                <input
                  value={form.name}
                  onChange={(event) => updateFormField("name", event.target.value)}
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
                    onChange={(event) => updateFormField("slug", event.target.value)}
                    onBlur={onSlugBlur}
                  />
                </div>
              </Field>
              <p className={styles.inlineStatus} role="status">
                {slugStatus}
              </p>
              <Field label="معرفی کوتاه" error={errors.bio}>
                <textarea
                  value={form.bio}
                  onChange={(event) => updateFormField("bio", event.target.value)}
                />
              </Field>
            </>
          ) : null}
          {section === "shipping" ? (
            <fieldset className={styles.shippingGroup}>
              <legend>روش‌هایی که خریدار می‌تواند انتخاب کند</legend>
              {shippingCodes.map((code) => {
                const method =
                  form.shippingMethods.find((item) => item.code === code) ??
                  defaultShippingMethod(code, false);
                return (
                  <div
                    className={styles.shippingMethod}
                    key={code}
                    role="group"
                    aria-labelledby={`shipping-${code}`}
                  >
                    <label className={styles.shippingToggle}>
                      <input
                        type="checkbox"
                        checked={method.enabled}
                        onChange={(event) =>
                          updateShipping(code, { enabled: event.target.checked })
                        }
                      />
                      <span id={`shipping-${code}`}>
                        {defaultShippingMethod(code).label}
                      </span>
                    </label>
                    {method.enabled ? (
                      <div className={styles.shippingTerms}>
                        <Field
                          label="عنوانی که خریدار می‌بیند"
                          error={
                            errors.shipping &&
                            (method.label.trim().length < 2 ||
                              method.label.trim().length > 60)
                              ? "عنوان باید بین ۲ تا ۶۰ نویسه باشد."
                              : undefined
                          }
                        >
                          <input
                            value={method.label}
                            onChange={(event) =>
                              updateShipping(code, { label: event.target.value })
                            }
                          />
                        </Field>
                        <Field
                          label="هزینه ارسال (تومان)"
                          hint="برای ارسال رایگان صفر بنویسید."
                          error={
                            errors.shipping && !validShippingFee(method.feeToman)
                              ? "هزینه را با عدد فارسی یا انگلیسی و بدون جداکننده بنویسید."
                              : undefined
                          }
                        >
                          <input
                            inputMode="numeric"
                            dir="ltr"
                            value={method.feeToman}
                            onChange={(event) =>
                              updateShipping(code, { feeToman: event.target.value })
                            }
                          />
                        </Field>
                        <Field
                          label="زمان تقریبی تحویل"
                          error={
                            errors.shipping &&
                            (method.estimatedDeliveryText.trim().length < 2 ||
                              method.estimatedDeliveryText.trim().length > 120)
                              ? "زمان تحویل باید بین ۲ تا ۱۲۰ نویسه باشد."
                              : undefined
                          }
                        >
                          <input
                            value={method.estimatedDeliveryText}
                            onChange={(event) =>
                              updateShipping(code, {
                                estimatedDeliveryText: event.target.value,
                              })
                            }
                          />
                        </Field>
                      </div>
                    ) : null}
                  </div>
                );
              })}
              {errors.shipping ? (
                <p className={styles.error} role="alert">
                  {errors.shipping}
                </p>
              ) : null}
            </fieldset>
          ) : null}
          {section === "returns" ? (
            <>
              <Field
                label="سیاست مرجوعی"
                hint="شرایط، مهلت و قدم بعدی خریدار را روشن بنویسید. سوو بازپرداخت را تضمین نمی‌کند."
                error={errors.returnPolicy}
              >
                <textarea
                  value={form.returnPolicy}
                  onChange={(event) =>
                    updateFormField("returnPolicy", event.target.value)
                  }
                />
              </Field>
            </>
          ) : null}
          {section === "appearance" ? (
            <>
              <article
                className={styles.livePreview}
                aria-label="پیش‌نمایش زنده فروشگاه"
              >
                <div
                  className={styles.liveCover}
                  style={{ backgroundColor: form.themeColor }}
                >
                  {coverPreviewUrl || storedMedia.coverMediaId ? (
                    <img
                      src={
                        coverPreviewUrl ||
                        `/api/store/media/${storedMedia.coverMediaId}`
                      }
                      alt="پیش‌نمایش تصویر روی جلد"
                    />
                  ) : null}
                </div>
                <div className={styles.liveIdentity}>
                  {logoPreviewUrl || storedMedia.logoMediaId ? (
                    <img
                      src={
                        logoPreviewUrl || `/api/store/media/${storedMedia.logoMediaId}`
                      }
                      alt="پیش‌نمایش لوگو"
                    />
                  ) : (
                    <span
                      className={styles.liveLogo}
                      style={{
                        backgroundColor: form.themeColor,
                        color: readableStoreForeground(form.themeColor),
                      }}
                    >
                      {form.name.trim().slice(0, 1) || "س"}
                    </span>
                  )}
                  <div>
                    <strong>{form.name.trim() || "نام فروشگاه"}</strong>
                    <p>{form.bio.trim() || "معرفی کوتاه فروشگاه"}</p>
                  </div>
                </div>
              </article>
              <Field label="رنگ فروشگاه">
                <input
                  type="color"
                  value={form.themeColor}
                  onChange={(event) =>
                    updateFormField("themeColor", event.target.value)
                  }
                />
              </Field>
              <Field label="لوگو" error={errors.logo}>
                <FilePicker label="لوگو" file={logo} onChange={setLogo} />
              </Field>
              <Field label="تصویر روی جلد" error={errors.cover}>
                <FilePicker label="تصویر روی جلد" file={cover} onChange={setCover} />
              </Field>
            </>
          ) : null}
          <p className={styles.message} role="alert" aria-live="polite">
            {message}
          </p>
          <button
            className={styles.primaryButton}
            type="button"
            disabled={pending}
            onClick={saveAndExit}
          >
            {pending ? "در حال ذخیره…" : "ذخیره و خروج"}
          </button>
        </form>
      </section>
    </main>
  );
}

function sectionDescription(section: Exclude<StoreSection, "setup">) {
  return {
    profile: "نام، لینک و معرفی کوتاهی را کامل کنید که خریدار در فروشگاه می‌بیند.",
    shipping: "هزینه و زمان هر روش را پیش از انتخاب برای خریدار روشن کنید.",
    returns: "خریدار باید پیش از سفارش بداند در صورت مشکل چه کاری انجام دهد.",
    appearance: "هویت فروشگاه را تغییر دهید و نتیجه را همان‌جا ببینید.",
  }[section];
}

function validateSection(section: StoreSection, form: StoreForm): FieldErrors {
  const all = validateForm(form);
  if (section === "profile") {
    return {
      ...(all.name ? { name: all.name } : {}),
      ...(all.slug ? { slug: all.slug } : {}),
      ...(all.bio ? { bio: all.bio } : {}),
    };
  }
  if (section === "returns") {
    return all.returnPolicy ? { returnPolicy: all.returnPolicy } : {};
  }
  if (section === "shipping") {
    const enabled = form.shippingMethods.filter((method) => method.enabled);
    const invalid = enabled.some(
      (method) =>
        method.label.trim().length < 2 ||
        method.label.trim().length > 60 ||
        !validShippingFee(method.feeToman) ||
        method.estimatedDeliveryText.trim().length < 2 ||
        method.estimatedDeliveryText.trim().length > 120,
    );
    return enabled.length === 0
      ? { shipping: "دست‌کم یک روش ارسال را فعال کنید." }
      : invalid
        ? { shipping: "عنوان، هزینه و زمان تحویل روش‌های فعال را کامل کنید." }
        : {};
  }
  return {};
}

function buildSectionInput(
  section: Exclude<StoreSection, "setup">,
  form: StoreForm,
  media: DraftMedia,
): StoreDraftInput {
  if (section === "profile") {
    return {
      name: form.name.trim(),
      slug: form.slug.trim() as StoreDraftInput["slug"],
      bio: form.bio.trim(),
    };
  }
  if (section === "shipping") {
    return { shippingMethods: form.shippingMethods.map(toShippingInput) };
  }
  if (section === "returns") return { returnPolicy: form.returnPolicy.trim() };
  return { ...media, themeColor: form.themeColor };
}

function buildDraftInput(
  form: typeof emptyForm,
  media: DraftMedia,
  complete: boolean,
): StoreDraftInput {
  return {
    ...(complete || form.name.trim().length >= 2 ? { name: form.name.trim() } : {}),
    ...(complete ||
    (/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(form.slug) && form.slug.length >= 3)
      ? { slug: form.slug.trim() as StoreDraftInput["slug"] }
      : {}),
    ...(complete || form.bio.trim().length >= 2 ? { bio: form.bio.trim() } : {}),
    shippingMethods: form.shippingMethods.map(toShippingInput),
    ...(complete || form.returnPolicy.trim().length >= 10
      ? { returnPolicy: form.returnPolicy.trim() }
      : {}),
    settlementDestination: { kind: "TEST" },
    ...media,
    themeColor: form.themeColor,
  };
}

function FilePicker({
  label,
  file,
  onChange,
}: {
  label: string;
  file?: File;
  onChange: (file?: File) => void;
}) {
  return (
    <span className={styles.filePicker}>
      <input
        className={styles.filePickerInput}
        type="file"
        aria-label={label}
        accept={MEDIA_UPLOAD_ACCEPTED_TYPES.join(",")}
        onChange={(event) => onChange(event.target.files?.[0])}
      />
      <span className={styles.filePickerButton}>انتخاب فایل</span>
      <span className={styles.filePickerName}>
        {file?.name ?? "فایلی انتخاب نشده است"}
      </span>
    </span>
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
  const nameLength = form.name.trim().length;
  if (nameLength < 2) errors.name = "نام فروشگاه را کامل‌تر بنویسید.";
  else if (nameLength > 80) errors.name = "نام فروشگاه حداکثر ۸۰ نویسه است.";
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(form.slug) || form.slug.length < 3)
    errors.slug = "شناسه لینک باید دست‌کم سه نویسه و با قالب نمونه باشد.";
  else if (form.slug.length > 48) errors.slug = "شناسه لینک حداکثر ۴۸ نویسه است.";
  const bioLength = form.bio.trim().length;
  if (bioLength < 2) errors.bio = "یک معرفی کوتاه برای فروشگاه بنویسید.";
  else if (bioLength > 240) errors.bio = "معرفی کوتاه حداکثر ۲۴۰ نویسه است.";
  const returnPolicyLength = form.returnPolicy.trim().length;
  if (returnPolicyLength < 10)
    errors.returnPolicy = "شرایط مرجوعی را کمی روشن‌تر بنویسید.";
  else if (returnPolicyLength > 1_000)
    errors.returnPolicy = "شرایط مرجوعی حداکثر ۱۰۰۰ نویسه است.";
  return errors;
}

function hasIdentityErrors(errors: FieldErrors) {
  return Boolean(errors.name || errors.slug || errors.bio);
}

const shippingCodes = ["NATIONAL_POST", "COURIER", "PICKUP"] as const;

function defaultShippingMethod(code: ShippingCode, enabled = true): ShippingForm {
  return {
    code,
    label:
      code === "NATIONAL_POST"
        ? "پست پیشتاز"
        : code === "COURIER"
          ? "پیک"
          : "دریافت حضوری",
    feeToman: "0",
    estimatedDeliveryText:
      code === "PICKUP"
        ? "هماهنگی زمان دریافت پس از ثبت سفارش"
        : "زمان دقیق ارسال هنگام ثبت سفارش مشخص می‌شود.",
    enabled,
  };
}

function toShippingInput(method: ShippingForm) {
  return {
    code: method.code,
    label: method.label.trim(),
    fixedFee: {
      amount: Number.parseInt(latinDigits(method.feeToman), 10) * 10,
      currency: "IRR" as const,
    },
    estimatedDeliveryText: method.estimatedDeliveryText.trim(),
    enabled: method.enabled,
  };
}

function latinDigits(value: string) {
  return value
    .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
    .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)));
}

function validShippingFee(value: string) {
  const normalized = latinDigits(value);
  if (!/^\d+$/.test(normalized)) return false;
  const toman = Number(normalized);
  return Number.isSafeInteger(toman) && Number.isSafeInteger(toman * 10);
}

async function uploadMedia(
  file: File,
  purpose: "STORE_LOGO" | "STORE_COVER",
): Promise<MediaReference> {
  if (file.size > MEDIA_UPLOAD_MAX_BYTES) {
    throw new MediaUploadError(
      "حجم تصویر باید حداکثر ۱۰ مگابایت باشد.",
      mediaField(purpose),
    );
  }
  if (!(MEDIA_UPLOAD_ACCEPTED_TYPES as readonly string[]).includes(file.type)) {
    throw new MediaUploadError(
      "فقط تصویر JPEG، PNG یا WebP پذیرفته می‌شود.",
      mediaField(purpose),
    );
  }
  const bitmap = await createImageBitmap(file).catch(() => undefined);
  if (!bitmap)
    throw new MediaUploadError(
      "فایل تصویر خراب است یا کامل خوانده نمی‌شود.",
      mediaField(purpose),
    );
  const pixels = bitmap.width * bitmap.height;
  bitmap.close();
  if (pixels > MEDIA_UPLOAD_MAX_PIXELS) {
    throw new MediaUploadError(
      "ابعاد تصویر باید حداکثر ۲۴ مگاپیکسل باشد.",
      mediaField(purpose),
    );
  }
  const form = new FormData();
  form.set("purpose", purpose);
  form.set("file", file, file.name);
  const response = await fetch("/api/store/seller/media", {
    method: "POST",
    body: form,
  });
  const body: unknown = await response.json();
  const parsed = mediaReferenceContract.safeParse(body);
  if (!response.ok || !parsed.success)
    throw new MediaUploadError(humanError(body), mediaField(purpose));
  return parsed.data;
}

function mediaField(purpose: "STORE_LOGO" | "STORE_COVER") {
  return purpose === "STORE_LOGO" ? ("logo" as const) : ("cover" as const);
}

class MediaUploadError extends Error {
  constructor(
    message: string,
    readonly field: "logo" | "cover",
  ) {
    super(message);
  }
}
class StoreDraftSaveError extends Error {}

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

function publicationError(body: unknown) {
  if (typeof body !== "object" || body === null || !("details" in body)) {
    return humanError(body);
  }
  const details = body.details as { issues?: Array<{ field?: string }> };
  const labels: Record<string, string> = {
    name: "نام فروشگاه",
    slug: "شناسه لینک",
    bio: "معرفی کوتاه",
    shipping_method: "روش ارسال فعال",
    return_policy: "سیاست مرجوعی",
    settlement_destination: "مقصد تسویه",
  };
  const missing = [
    ...new Set(
      (details.issues ?? []).flatMap((issue) =>
        issue.field && labels[issue.field] ? [labels[issue.field]] : [],
      ),
    ),
  ];
  return missing.length > 0
    ? `برای انتشار این بخش‌ها را کامل کنید: ${missing.join("، ")}.`
    : humanError(body);
}
