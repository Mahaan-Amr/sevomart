"use client";

import {
  purchaseExperienceContract,
  purchaseExperienceEligibilityDecisionV2Contract,
  type PurchaseExperienceMediaContext,
} from "@sevo/contracts/content/v2";
import {
  MEDIA_UPLOAD_ACCEPTED_TYPES,
  MEDIA_UPLOAD_MAX_BYTES,
  PURCHASE_EXPERIENCE_MEDIA_MAX_ITEMS,
} from "@sevo/contracts/media/v1";
import { useEffect, useRef, useState } from "react";

import { loginHref } from "../../../../lib/navigation";
import { readPurchaseExperienceEligibility } from "../../../../lib/purchase-experience-client";
import {
  preparePurchaseExperienceImageUpload,
  preparePurchaseExperienceMediaContext,
  PurchaseExperienceMediaUploadError,
} from "../../../../lib/purchase-experience-media";
import styles from "./purchase-experience.module.css";

type Eligibility = ReturnType<
  typeof purchaseExperienceEligibilityDecisionV2Contract.parse
>;
type PreparedContextRequest = ReturnType<typeof preparePurchaseExperienceMediaContext>;
type PreparedImageUpload = ReturnType<typeof preparePurchaseExperienceImageUpload>;
type PreparedImageUploadRecord = {
  contextId: string;
  upload: PreparedImageUpload;
};
type SelectedImage = {
  localId: string;
  file: File;
  previewUrl: string;
  state: "SELECTED" | "UPLOADING" | "READY" | "ERROR";
  mediaId?: string;
  error?: string;
  removable?: boolean;
};

const DEFINITIVE_MEDIA_REJECTIONS = new Set([
  "ANIMATED_IMAGE",
  "CORRUPT_IMAGE",
  "FILE_TOO_LARGE",
  "IDEMPOTENCY_CONFLICT",
  "IMAGE_TOO_LARGE",
  "MEDIA_NOT_FOUND",
  "MIME_MISMATCH",
  "PRECONDITION_REQUIRED",
  "RATE_LIMITED",
  "REQUIRED",
  "TOO_MANY_FILES",
  "UNSUPPORTED_FORMAT",
]);

export function PurchaseExperienceForm({
  orderItemId,
  returnTo,
  resumePath,
}: {
  orderItemId: string;
  returnTo: string;
  resumePath: string;
}) {
  const [eligibility, setEligibility] = useState<Eligibility>();
  const [loading, setLoading] = useState(true);
  const [rating, setRating] = useState(0);
  const [text, setText] = useState("");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [published, setPublished] = useState(false);
  const [submissionStarted, setSubmissionStarted] = useState(false);
  const [images, setImages] = useState<SelectedImage[]>([]);
  const idempotencyKey = useRef<string | undefined>(undefined);
  const mediaContextRequest = useRef<PreparedContextRequest | undefined>(undefined);
  const mediaContext = useRef<PurchaseExperienceMediaContext | undefined>(undefined);
  const mediaContextPromise = useRef<
    Promise<PurchaseExperienceMediaContext> | undefined
  >(undefined);
  const imageUploads = useRef(new Map<string, PreparedImageUploadRecord>());
  const usedUploadSlots = useRef(new Set<string>());
  const previewUrls = useRef(new Set<string>());

  useEffect(() => {
    let active = true;
    void readPurchaseExperienceEligibility(orderItemId)
      .then((result) => {
        if (result.status === "UNAUTHENTICATED") {
          window.location.assign(loginHref(resumePath, returnTo));
          return;
        }
        if (active) setEligibility(result.decision);
      })
      .catch(() => {
        if (active) setMessage("شرایط ثبت تجربه دریافت نشد. دوباره تلاش کنید.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [orderItemId, resumePath, returnTo]);

  useEffect(
    () => () => {
      for (const previewUrl of previewUrls.current) {
        URL.revokeObjectURL(previewUrl);
      }
    },
    [],
  );

  async function ensureMediaContext() {
    if (mediaContext.current) return mediaContext.current;
    mediaContextRequest.current ??= preparePurchaseExperienceMediaContext({
      orderItemId,
    });
    mediaContextPromise.current ??= mediaContextRequest.current
      .run()
      .then((context) => {
        mediaContext.current = context;
        return context;
      })
      .catch((error: unknown) => {
        mediaContextPromise.current = undefined;
        throw error;
      });
    return mediaContextPromise.current;
  }

  async function uploadImage(localId: string, file: File) {
    usedUploadSlots.current.add(localId);
    setImages((current) =>
      current.map((image) =>
        image.localId === localId
          ? { ...image, state: "UPLOADING", error: undefined }
          : image,
      ),
    );
    try {
      const context = await ensureMediaContext();
      let record = imageUploads.current.get(localId);
      if (!record || record.contextId !== context.contextId) {
        const upload = preparePurchaseExperienceImageUpload({
          contextId: context.contextId,
          file,
          idempotencyKey: record?.upload.idempotencyKey,
        });
        record = { contextId: context.contextId, upload };
        imageUploads.current.set(localId, record);
      }
      const reference = await record.upload.run();
      setImages((current) =>
        current.map((image) =>
          image.localId === localId
            ? { ...image, state: "READY", mediaId: reference.id }
            : image,
        ),
      );
      idempotencyKey.current = undefined;
      return reference.id;
    } catch (error) {
      mediaContext.current = undefined;
      mediaContextPromise.current = undefined;
      const errorMessage =
        error instanceof PurchaseExperienceMediaUploadError
          ? error.userMessage
          : "بارگذاری تصویر انجام نشد. دوباره تلاش کنید.";
      const removable =
        error instanceof PurchaseExperienceMediaUploadError &&
        Boolean(error.issueCode && DEFINITIVE_MEDIA_REJECTIONS.has(error.issueCode));
      if (removable) usedUploadSlots.current.delete(localId);
      setImages((current) =>
        current.map((image) =>
          image.localId === localId
            ? { ...image, state: "ERROR", error: errorMessage, removable }
            : image,
        ),
      );
      return undefined;
    }
  }

  function addImages(event: React.ChangeEvent<HTMLInputElement>) {
    const selectedFiles = Array.from(event.target.files ?? []);
    event.target.value = "";
    const locallyReservedSlots = images.filter(
      (image) => !usedUploadSlots.current.has(image.localId),
    ).length;
    const available =
      PURCHASE_EXPERIENCE_MEDIA_MAX_ITEMS -
      usedUploadSlots.current.size -
      locallyReservedSlots;
    if (available <= 0) {
      setMessage("حداکثر چهار تصویر می‌توانید اضافه کنید.");
      return;
    }
    const accepted: SelectedImage[] = [];
    let selectionMessage = "";
    for (const file of selectedFiles.slice(0, available)) {
      if (!MEDIA_UPLOAD_ACCEPTED_TYPES.some((type) => type === file.type)) {
        selectionMessage = "فقط تصویر JPEG، PNG یا WebP انتخاب کنید.";
        continue;
      }
      if (file.size > MEDIA_UPLOAD_MAX_BYTES) {
        selectionMessage = "حجم هر تصویر باید حداکثر ۱۰ مگابایت باشد.";
        continue;
      }
      const previewUrl = URL.createObjectURL(file);
      previewUrls.current.add(previewUrl);
      accepted.push({
        localId: crypto.randomUUID(),
        file,
        previewUrl,
        state: "SELECTED",
      });
    }
    if (selectedFiles.length > available) {
      selectionMessage = "حداکثر چهار تصویر می‌توانید اضافه کنید.";
    }
    setMessage(selectionMessage);
    if (accepted.length === 0) return;
    setImages((current) => [...current, ...accepted]);
    idempotencyKey.current = undefined;
  }

  function removeImage(image: SelectedImage) {
    previewUrls.current.delete(image.previewUrl);
    URL.revokeObjectURL(image.previewUrl);
    imageUploads.current.delete(image.localId);
    setImages((current) =>
      current.filter((candidate) => candidate.localId !== image.localId),
    );
    idempotencyKey.current = undefined;
    setMessage("");
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!eligibility?.eligible || rating < 1 || rating > 5) {
      setMessage("یک امتیاز از ۱ تا ۵ انتخاب کنید.");
      return;
    }
    setPending(true);
    setMessage("");
    try {
      const uploadedMediaIds = await Promise.all(
        images.map((image) =>
          image.state === "READY" && image.mediaId
            ? image.mediaId
            : uploadImage(image.localId, image.file),
        ),
      );
      const mediaIds = uploadedMediaIds.filter((mediaId): mediaId is string =>
        Boolean(mediaId),
      );
      if (mediaIds.length !== images.length) {
        setMessage("بارگذاری تصویر کامل نشد. دوباره تلاش کنید.");
        return;
      }
      setSubmissionStarted(true);
      const requestKey = idempotencyKey.current ?? crypto.randomUUID();
      idempotencyKey.current = requestKey;
      const response = await fetch("/api/purchase-experiences", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": requestKey,
        },
        body: JSON.stringify({
          buyerId: eligibility.buyerId,
          orderItemId,
          rating,
          text,
          mediaIds,
        }),
      });
      const body: unknown = await response.json();
      if (response.status === 401) {
        window.location.assign(loginHref(resumePath, returnTo));
        return;
      }
      if (!response.ok) {
        const error = body as { code?: string; message?: string };
        if (error.code === "ALREADY_SUBMITTED") {
          setEligibility({ eligible: false, reason: "ALREADY_SUBMITTED" });
        }
        throw new Error(error.message ?? "ثبت تجربه انجام نشد.");
      }
      const parsed = purchaseExperienceContract.safeParse(body);
      if (!parsed.success) throw new Error("پاسخ ثبت تجربه معتبر نبود.");
      setPublished(true);
      setMessage("تجربه شما با نشان «خرید تأییدشده» منتشر شد.");
    } catch (error) {
      setMessage(
        error instanceof Error && /[\u0600-\u06ff]/.test(error.message)
          ? error.message
          : "ثبت کامل تأیید نشد. برای جلوگیری از ثبت تکراری، همین اطلاعات را دوباره ارسال کنید.",
      );
    } finally {
      setPending(false);
    }
  }

  if (loading) {
    return <ExperienceState text="شرایط خرید در حال بررسی است…" />;
  }
  if (!eligibility?.eligible) {
    return (
      <main className={styles.page}>
        <section className={styles.panel} aria-labelledby="experience-title">
          <a className={styles.back} href={returnTo}>
            بازگشت
          </a>
          <h1 id="experience-title">ثبت تجربه خرید</h1>
          <p>
            {eligibility?.reason === "ALREADY_SUBMITTED"
              ? "برای این خرید قبلاً یک تجربه ثبت شده است."
              : "این خرید هنوز شرایط ثبت تجربه را ندارد."}
          </p>
          {message ? <p role="alert">{message}</p> : null}
        </section>
      </main>
    );
  }

  const locallyReservedSlotCount = images.filter(
    (image) => !usedUploadSlots.current.has(image.localId),
  ).length;
  const mediaLimitReached =
    usedUploadSlots.current.size + locallyReservedSlotCount >=
    PURCHASE_EXPERIENCE_MEDIA_MAX_ITEMS;

  return (
    <main className={styles.page}>
      <section className={styles.panel} aria-labelledby="experience-title">
        <a className={styles.back} href={returnTo}>
          بازگشت
        </a>
        <h1 id="experience-title">تجربه این خرید را ثبت کنید</h1>
        <p className={styles.lead}>
          سوو این خرید و ارتباط آن با همان کالا و فروشگاه را تأیید کرده است.
        </p>
        {published ? (
          <div className={styles.success} role="status">
            <strong>منتشر شد</strong>
            <p>{message}</p>
            <a className={styles.primaryLink} href={returnTo}>
              بازگشت به سفارش
            </a>
          </div>
        ) : (
          <form className={styles.form} onSubmit={submit}>
            <fieldset disabled={pending || submissionStarted}>
              <legend>امتیاز شما</legend>
              <div className={styles.ratings}>
                {[1, 2, 3, 4, 5].map((value) => (
                  <label key={value}>
                    <input
                      type="radio"
                      name="rating"
                      value={value}
                      checked={rating === value}
                      onChange={() => {
                        setRating(value);
                        idempotencyKey.current = undefined;
                      }}
                      required
                    />
                    <span>{value.toLocaleString("fa-IR")}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <label htmlFor="experience-text">توضیح شما (اختیاری)</label>
            <textarea
              id="experience-text"
              value={text}
              maxLength={2000}
              rows={6}
              disabled={pending || submissionStarted}
              onChange={(event) => {
                setText(event.target.value);
                idempotencyKey.current = undefined;
              }}
            />
            <span className={styles.counter}>
              {text.length.toLocaleString("fa-IR")} از ۲٬۰۰۰ نویسه
            </span>
            <div className={styles.mediaField}>
              <span className={styles.mediaLabel}>تصویر (اختیاری)</span>
              <label
                className={styles.mediaPicker}
                aria-disabled={pending || submissionStarted || mediaLimitReached}
              >
                افزودن تصویر
                <input
                  className={styles.fileInput}
                  type="file"
                  accept={MEDIA_UPLOAD_ACCEPTED_TYPES.join(",")}
                  multiple
                  disabled={pending || submissionStarted || mediaLimitReached}
                  aria-describedby="experience-image-help"
                  onChange={addImages}
                />
              </label>
              <p id="experience-image-help" className={styles.mediaHelp}>
                حداکثر ۴ تصویر JPEG، PNG یا WebP؛ هر تصویر تا ۱۰ مگابایت.
              </p>
              {images.length > 0 ? (
                <ul className={styles.mediaList} aria-label="تصاویر انتخاب‌شده">
                  {images.map((image) => (
                    <li key={image.localId} className={styles.mediaItem}>
                      {/* Local previews never leave the buyer's browser. */}
                      <img
                        src={image.previewUrl}
                        alt={`پیش‌نمایش ${image.file.name}`}
                      />
                      <div className={styles.mediaDetails}>
                        <strong>{image.file.name}</strong>
                        <p
                          className={
                            image.state === "ERROR"
                              ? styles.mediaError
                              : styles.mediaStatus
                          }
                          role={image.state === "ERROR" ? "alert" : "status"}
                        >
                          {image.state === "SELECTED"
                            ? "آماده بارگذاری است."
                            : image.state === "UPLOADING"
                              ? "در حال بارگذاری…"
                              : image.state === "READY"
                                ? "تصویر آماده است."
                                : image.error}
                        </p>
                      </div>
                      <div className={styles.mediaActions}>
                        {image.state === "ERROR" ? (
                          <button
                            type="button"
                            onClick={() => void uploadImage(image.localId, image.file)}
                          >
                            تلاش دوباره
                          </button>
                        ) : null}
                        {image.state === "SELECTED" ||
                        (image.state === "ERROR" && image.removable) ? (
                          <button type="button" onClick={() => removeImage(image)}>
                            حذف
                          </button>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
            <p className={styles.moderation}>
              تجربه پس از ثبت با وضعیت «منتشرشده» و نشان «خرید تأییدشده» دیده می‌شود.
            </p>
            {message ? <p role="alert">{message}</p> : null}
            <button className={styles.primary} type="submit" disabled={pending}>
              {pending
                ? "در حال ثبت…"
                : submissionStarted
                  ? "تلاش دوباره برای ثبت"
                  : "ثبت تجربه خرید"}
            </button>
          </form>
        )}
      </section>
    </main>
  );
}

function ExperienceState({ text }: { text: string }) {
  return (
    <main className={styles.page}>
      <section className={styles.panel} role="status">
        <h1>ثبت تجربه خرید</h1>
        <p>{text}</p>
      </section>
    </main>
  );
}
