"use client";

import {
  productPreviewContract,
  productViewContract,
  publicProductContract,
  type ProductView,
  type PublicProduct,
} from "@sevo/contracts/product/v1";
import {
  MEDIA_UPLOAD_ACCEPTED_TYPES,
  MEDIA_UPLOAD_MAX_BYTES,
  mediaReferenceContract,
  type MediaId,
} from "@sevo/contracts/media/v1";
import { storeDraftContract } from "@sevo/contracts/store/v1";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { formatIrrAsToman } from "../../../../../lib/format-money";
import styles from "./simple-product-builder.module.css";

type Step = "details" | "images" | "sale" | "review" | "published" | "unpublished";
type AxisValue = { clientKey: string; name: string };
type Axis = { clientKey: string; name: string; values: AxisValue[] };
type VariantDraft = {
  clientKey: string;
  combination: Array<{ axisClientKey: string; valueClientKey: string }>;
};
type SaleRow = {
  variantId?: string;
  priceToman: string;
  sku: string;
  onHand: string;
  inventoryRevision: number;
};
type IdempotentRequest = { payload: string; key: string };
type RequestRef = { current: IdempotentRequest | undefined };

const PRODUCT_ID_STORAGE = "sevo-product-authoring-id";
const CREATE_KEY_STORAGE = "sevo-product-authoring-create-key";
const LAST_PRODUCT_ID_STORAGE = "sevo-last-product-id";
const WRITE_TIMEOUT_MS = 8_000;

export function SimpleProductBuilder({
  productId: requestedProductId,
}: {
  productId?: string;
}) {
  const [step, setStep] = useState<Step>("details");
  const [productId, setProductId] = useState("");
  const [revision, setRevision] = useState(0);
  const [productState, setProductState] = useState<ProductView["state"]>("DRAFT");
  const [storeSlug, setStoreSlug] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [mediaId, setMediaId] = useState<MediaId>();
  const [image, setImage] = useState<File>();
  const [kind, setKind] = useState<"simple" | "multi">("simple");
  const [axes, setAxes] = useState<Axis[]>([]);
  const [saleRows, setSaleRows] = useState<Record<string, SaleRow>>({});
  const [preview, setPreview] = useState<PublicProduct>();
  const [issues, setIssues] = useState<Array<{ path: string; code: string }>>([]);
  const [message, setMessage] = useState("");
  const [showDetailsErrors, setShowDetailsErrors] = useState(false);
  const [showImageError, setShowImageError] = useState(false);
  const [showSaleErrors, setShowSaleErrors] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const saveRequest = useRef<IdempotentRequest | undefined>(undefined);
  const publishRequest = useRef<IdempotentRequest | undefined>(undefined);
  const unpublishRequest = useRef<IdempotentRequest | undefined>(undefined);
  const variants = useMemo(
    () => buildVariants(kind === "simple" ? [] : axes),
    [axes, kind],
  );

  useEffect(() => {
    void initialize();
  }, []);

  useEffect(() => {
    setSaleRows((current) =>
      Object.fromEntries(
        variants.map((variant) => [
          variant.clientKey,
          current[variant.clientKey] ?? {
            priceToman: "",
            sku: "",
            onHand: "0",
            inventoryRevision: 0,
          },
        ]),
      ),
    );
  }, [variants]);

  async function initialize() {
    setLoading(true);
    try {
      const slugResponse = await fetch("/api/store/seller/store/draft", {
        cache: "no-store",
      });
      if (redirectIfUnauthorized(slugResponse)) return;
      const slugBody: unknown = await slugResponse.json();
      const storeDraft = storeDraftContract.safeParse(slugBody);
      if (slugResponse.ok && storeDraft.success && storeDraft.data.slug) {
        setStoreSlug(storeDraft.data.slug);
      }
      const savedProductId =
        requestedProductId ?? sessionStorage.getItem(PRODUCT_ID_STORAGE);
      if (savedProductId) {
        const response = await fetch(`/api/store/seller/products/${savedProductId}`, {
          cache: "no-store",
        });
        if (redirectIfUnauthorized(response)) return;
        if (response.ok) {
          const parsed = productViewContract.safeParse(await response.json());
          if (parsed.success) {
            setProductId(parsed.data.productId);
            hydrate(parsed.data);
            return;
          }
        }
        if (!requestedProductId) {
          sessionStorage.removeItem(PRODUCT_ID_STORAGE);
          sessionStorage.removeItem(CREATE_KEY_STORAGE);
        }
      }
      if (requestedProductId) throw new Error("کالا برای ویرایش پیدا نشد.");
      const response = await fetch("/api/store/seller/products", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": persistentCreateKey(),
        },
        body: "{}",
      });
      if (redirectIfUnauthorized(response)) return;
      const body: unknown = await response.json();
      if (
        !response.ok ||
        typeof body !== "object" ||
        body === null ||
        !("productId" in body) ||
        typeof body.productId !== "string"
      ) {
        throw new Error(humanError(body, "پیش‌نویس کالا ساخته نشد."));
      }
      setProductId(body.productId);
      sessionStorage.setItem(PRODUCT_ID_STORAGE, body.productId);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "پیش‌نویس کالا ساخته نشد.");
    } finally {
      setLoading(false);
    }
  }

  function hydrate(product: ProductView) {
    setRevision(product.revision);
    setProductState(product.state);
    localStorage.setItem(LAST_PRODUCT_ID_STORAGE, product.productId);
    if (!product.workingCopy) return;
    setName(product.workingCopy.name ?? "");
    setDescription(product.workingCopy.description);
    setMediaId(product.workingCopy.orderedMediaIds[0]);
    setAxes(product.workingCopy.axes);
    setKind(product.workingCopy.axes.length === 0 ? "simple" : "multi");
    const inventory = new Map(
      product.inventory.map((row) => [row.variantId, row] as const),
    );
    setSaleRows(
      Object.fromEntries(
        product.workingCopy.variants.map((variant) => {
          const stock = inventory.get(variant.variantId);
          return [
            variant.clientKey,
            {
              variantId: variant.variantId,
              priceToman: variant.price ? String(variant.price.amount / 10) : "",
              sku: variant.sku ?? "",
              onHand: String(stock?.onHand ?? 0),
              inventoryRevision: stock?.revision ?? 0,
            },
          ];
        }),
      ),
    );
  }

  async function saveWorkingCopy(options: { uploadImage?: boolean } = {}) {
    let effectiveMediaId = mediaId;
    if (options.uploadImage && image) {
      effectiveMediaId = await uploadProductImage(productId, image);
      setMediaId(effectiveMediaId);
    }
    const currentVariants = buildVariants(kind === "simple" ? [] : axes);
    const payload = {
      expectedRevision: revision,
      workingCopy: {
        name: name.trim().length >= 2 ? name : null,
        description,
        orderedMediaIds: effectiveMediaId ? [effectiveMediaId] : [],
        axes: kind === "simple" ? [] : axes,
        variants: currentVariants.map((variant) => {
          const sale = saleRows[variant.clientKey];
          return {
            ...variant,
            price: tomanToMoney(sale?.priceToman ?? ""),
            sku: sale?.sku.trim() || null,
          };
        }),
      },
      inventory: {
        rows: currentVariants.map((variant) => {
          const sale = saleRows[variant.clientKey];
          return {
            variantClientKey: variant.clientKey,
            onHand: parseStock(sale?.onHand ?? "0"),
            expectedRevision: sale?.inventoryRevision ?? 0,
          };
        }),
      },
    };
    const response = await fetchWriteWithRetry(
      `/api/store/seller/products/${productId}/working-copy`,
      {
        method: "PUT",
        headers: writeHeaders(revision, requestKey(saveRequest, payload)),
        body: JSON.stringify(payload),
      },
    );
    const body: unknown = await response.json();
    const parsed = productViewContract.safeParse(body);
    if (!response.ok || !parsed.success) {
      throw new Error(humanError(body, "ذخیره پیش‌نویس انجام نشد."));
    }
    hydrate(parsed.data);
    return parsed.data;
  }

  async function continueFromDetails() {
    setShowDetailsErrors(true);
    if (name.trim().length < 2) return setMessage("");
    await runPending(async () => {
      await saveWorkingCopy();
      setStep("images");
    });
  }

  async function continueFromImages() {
    setShowImageError(true);
    if (!mediaId && !image) return setMessage("");
    await runPending(async () => {
      await saveWorkingCopy({ uploadImage: true });
      setStep("sale");
    });
  }

  async function saveAndPreview() {
    setShowSaleErrors(true);
    if (kind === "multi" && !validAxes(axes)) {
      return setMessage("");
    }
    if (variants.length === 0 || variants.length > 50) {
      return setMessage("تعداد گونه‌ها باید بین ۱ تا ۵۰ باشد.");
    }
    for (const variant of variants) {
      const sale = saleRows[variant.clientKey];
      if (!tomanToMoney(sale?.priceToman ?? "")) {
        return setMessage("");
      }
      if (!Number.isInteger(Number(sale?.onHand)) || Number(sale?.onHand) < 0) {
        return setMessage("");
      }
    }
    await runPending(async () => {
      await saveWorkingCopy();
      const response = await fetchWithRetry(
        `/api/store/seller/products/${productId}/preview`,
        { cache: "no-store" },
      );
      const body: unknown = await response.json();
      const parsed = productPreviewContract.safeParse(body);
      if (!response.ok || !parsed.success) {
        throw new Error(humanError(body, "پیش‌نمایش آماده نشد."));
      }
      setIssues(parsed.data.issues);
      if (!parsed.data.ready || !parsed.data.projection) {
        setPreview(undefined);
        setStep("review");
        throw new Error("بخش‌های مشخص‌شده را کامل کنید.");
      }
      setPreview(parsed.data.projection);
      setStep("review");
    });
  }

  function backTo(next: Step) {
    setMessage("");
    setStep(next);
  }

  async function publish() {
    await runPending(async () => {
      const payload = { expectedRevision: revision, confirmed: true };
      const response = await fetchWriteWithRetry(
        `/api/store/seller/products/${productId}/publications`,
        {
          method: "POST",
          headers: writeHeaders(revision, requestKey(publishRequest, payload)),
          body: JSON.stringify(payload),
        },
      );
      const body: unknown = await response.json();
      const parsed = publicProductContract.safeParse(body);
      if (!response.ok || !parsed.success) {
        throw new Error(humanError(body, "انتشار کالا انجام نشد."));
      }
      setPreview(parsed.data);
      localStorage.setItem(LAST_PRODUCT_ID_STORAGE, productId);
      sessionStorage.removeItem(PRODUCT_ID_STORAGE);
      sessionStorage.removeItem(CREATE_KEY_STORAGE);
      setStep("published");
    });
  }

  async function unpublish() {
    await runPending(async () => {
      const payload = { expectedRevision: revision, reasonCode: "SELLER_REQUEST" };
      const response = await fetchWriteWithRetry(
        `/api/store/seller/products/${productId}/unpublication`,
        {
          method: "POST",
          headers: writeHeaders(revision, requestKey(unpublishRequest, payload)),
          body: JSON.stringify(payload),
        },
      );
      const body: unknown = await response.json();
      const parsed = productViewContract.safeParse(body);
      if (!response.ok || !parsed.success) {
        throw new Error(humanError(body, "توقف انتشار انجام نشد."));
      }
      hydrate(parsed.data);
      setPreview(undefined);
      setStep("unpublished");
    });
  }

  async function saveAndExit() {
    await runPending(async () => {
      await saveWorkingCopy({ uploadImage: Boolean(image) });
      window.location.assign("/seller/products");
    });
  }

  async function runPending(action: () => Promise<void>) {
    setPending(true);
    setMessage("");
    try {
      await action();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "تغییر ذخیره نشد.");
    } finally {
      setPending(false);
    }
  }

  if (loading)
    return (
      <main className={styles.page} aria-busy="true">
        <p>در حال آماده‌کردن پیش‌نویس کالا…</p>
      </main>
    );
  if (!productId) {
    return (
      <main className={styles.page}>
        <section className={styles.workspace} role="alert">
          <span className={styles.brand}>سوو</span>
          <h1>پیش‌نویس کالا آماده نشد</h1>
          <p>{message || "کمی بعد دوباره تلاش کنید."}</p>
          <button className={styles.primaryButton} onClick={() => location.reload()}>
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
          <p>آخرین نسخه کالا با قیمت و وضعیت موجودی جاری در فروشگاه دیده می‌شود.</p>
          <a
            className={styles.primaryButton}
            href={`/s/${storeSlug}/products/${productId}`}
          >
            دیدن کالا در فروشگاه
          </a>
          <Link
            className={styles.secondaryButton}
            href={`/seller/products/${productId}/edit`}
          >
            ویرایش کالا
          </Link>
        </section>
      </main>
    );
  }
  if (step === "unpublished") {
    return (
      <main className={styles.page}>
        <section className={styles.workspace}>
          <span className={styles.brand}>سوو</span>
          <h1>انتشار کالا متوقف شد</h1>
          <p>
            کالا برای خرید تازه دیده نمی‌شود و همه اطلاعات آن برای ویرایش باقی مانده
            است.
          </p>
          <button className={styles.primaryButton} onClick={() => setStep("details")}>
            ادامه ویرایش
          </button>
          <Link className={styles.secondaryButton} href="/seller/products">
            بازگشت به کالاها
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <section className={styles.workspace} aria-live="polite">
        <header className={styles.header}>
          <Link className={styles.textButton} href="/seller/products">
            بازگشت به کالاها
          </Link>
          <span className={styles.progress}>{stepLabel(step)} از ۴</span>
          <button
            type="button"
            className={styles.textButton}
            disabled={pending}
            onClick={saveAndExit}
          >
            ذخیره و خروج
          </button>
        </header>
        {step === "details" ? (
          <DetailsStep
            name={name}
            description={description}
            pending={pending}
            showErrors={showDetailsErrors}
            onName={setName}
            onDescription={setDescription}
            onContinue={continueFromDetails}
          />
        ) : null}
        {step === "images" ? (
          <ImageStep
            image={image}
            hasSavedImage={Boolean(mediaId)}
            pending={pending}
            showError={showImageError}
            onImage={setImage}
            onBack={() => backTo("details")}
            onContinue={continueFromImages}
          />
        ) : null}
        {step === "sale" ? (
          <SaleStep
            kind={kind}
            axes={axes}
            variantCount={variants.length}
            variants={variants}
            rows={saleRows}
            pending={pending}
            showErrors={showSaleErrors}
            onKind={(nextKind) => {
              setKind(nextKind);
              if (nextKind === "multi" && axes.length === 0) setAxes([newAxis()]);
            }}
            onAxes={setAxes}
            onRows={setSaleRows}
            onBack={() => backTo("images")}
            onContinue={saveAndPreview}
          />
        ) : null}
        {step === "review" ? (
          <>
            <h1>{preview ? "پیش‌نمایش کالا" : "کالا هنوز آماده انتشار نیست"}</h1>
            {preview ? <ProductPreview product={preview} /> : null}
            {issues.length > 0 ? (
              <ul className={styles.issues}>
                {issues.map((issue) => {
                  const guidance = readinessGuidance(issue.path);
                  return (
                    <li key={`${issue.path}-${issue.code}`}>
                      <span>{guidance.message}</span>
                      <button
                        className={styles.textButton}
                        onClick={() => setStep(guidance.step)}
                      >
                        {guidance.action}
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : null}
            <div className={styles.actions}>
              <button
                className={styles.secondaryButton}
                onClick={() => setStep("sale")}
              >
                برگشت و ویرایش
              </button>
              {preview ? (
                <div className={styles.reviewActions}>
                  {productState === "PUBLISHED" ? (
                    <button
                      className={styles.dangerButton}
                      disabled={pending}
                      onClick={unpublish}
                    >
                      {pending ? "در حال توقف…" : "توقف انتشار"}
                    </button>
                  ) : null}
                  <button
                    className={styles.primaryButton}
                    disabled={pending}
                    onClick={publish}
                  >
                    {pending
                      ? "در حال انتشار…"
                      : productState === "UNPUBLISHED"
                        ? "انتشار دوباره"
                        : productState === "PUBLISHED"
                          ? "انتشار تغییرها"
                          : "انتشار کالا"}
                  </button>
                </div>
              ) : null}
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

function DetailsStep(props: {
  name: string;
  description: string;
  pending: boolean;
  showErrors: boolean;
  onName: (value: string) => void;
  onDescription: (value: string) => void;
  onContinue: () => void;
}) {
  const nameError = props.showErrors && props.name.trim().length < 2;
  return (
    <>
      <h1>مشخصات کالا</h1>
      <p>نام و توضیح کوتاهی بنویسید که خریدار برای تصمیم‌گیری نیاز دارد.</p>
      <label className={styles.field}>
        <span>نام کالا</span>
        <input
          value={props.name}
          maxLength={120}
          aria-invalid={nameError}
          aria-describedby={nameError ? "product-name-error" : undefined}
          onChange={(event) => props.onName(event.target.value)}
        />
        {nameError ? (
          <small className={styles.fieldError} id="product-name-error">
            نام کالا باید دست‌کم دو نویسه باشد.
          </small>
        ) : null}
      </label>
      <label className={styles.field}>
        <span>توضیح کالا</span>
        <textarea
          value={props.description}
          maxLength={2000}
          onChange={(event) => props.onDescription(event.target.value)}
        />
      </label>
      <button
        className={styles.primaryButton}
        disabled={props.pending}
        onClick={props.onContinue}
      >
        {props.pending ? "در حال ذخیره…" : "ادامه"}
      </button>
    </>
  );
}

function ImageStep(props: {
  image?: File;
  hasSavedImage: boolean;
  pending: boolean;
  showError: boolean;
  onImage: (value?: File) => void;
  onBack: () => void;
  onContinue: () => void;
}) {
  const missing = props.showError && !props.image && !props.hasSavedImage;
  return (
    <>
      <h1>تصویر کالا</h1>
      <p>یک تصویر روشن انتخاب کنید؛ اصل فایل خصوصی می‌ماند.</p>
      <label className={styles.filePicker}>
        <span>انتخاب تصویر کالا</span>
        <input
          type="file"
          accept={MEDIA_UPLOAD_ACCEPTED_TYPES.join(",")}
          aria-invalid={missing}
          aria-describedby={missing ? "product-image-error" : undefined}
          onChange={(event) => props.onImage(event.target.files?.[0])}
        />
        <small>
          {props.image?.name ??
            (props.hasSavedImage ? "تصویر ذخیره شده است" : "تصویری انتخاب نشده است")}
        </small>
        {missing ? (
          <small className={styles.fieldError} id="product-image-error">
            یک تصویر برای کالا انتخاب کنید.
          </small>
        ) : null}
      </label>
      <div className={styles.actions}>
        <button
          className={styles.secondaryButton}
          disabled={props.pending}
          onClick={props.onBack}
        >
          برگشت
        </button>
        <button
          className={styles.primaryButton}
          disabled={props.pending}
          onClick={props.onContinue}
        >
          {props.pending ? "در حال ذخیره…" : "ادامه"}
        </button>
      </div>
    </>
  );
}

function VariantFields(props: {
  kind: "simple" | "multi";
  axes: Axis[];
  variantCount: number;
  showErrors: boolean;
  onKind: (kind: "simple" | "multi") => void;
  onAxes: (axes: Axis[]) => void;
}) {
  return (
    <section className={styles.saleSection} aria-labelledby="variant-structure-title">
      <h2 id="variant-structure-title">ساختار گونه‌ها</h2>
      <p>
        اگر خریدار باید رنگ، اندازه یا انتخاب دیگری داشته باشد، چندگونه را انتخاب کنید.
      </p>
      <div className={styles.choiceGroup} role="radiogroup" aria-label="ساختار گونه‌ها">
        <button
          type="button"
          role="radio"
          aria-checked={props.kind === "simple"}
          className={props.kind === "simple" ? styles.choiceActive : styles.choice}
          onClick={() => props.onKind("simple")}
        >
          یک گونه
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={props.kind === "multi"}
          className={props.kind === "multi" ? styles.choiceActive : styles.choice}
          onClick={() => props.onKind("multi")}
        >
          چندگونه
        </button>
      </div>
      {props.kind === "multi" ? (
        <div className={styles.axisList}>
          {props.axes.map((axis, axisIndex) => (
            <fieldset className={styles.axis} key={axis.clientKey}>
              <legend>محور {axisIndex + 1}</legend>
              <label className={styles.field}>
                <span>نام محور</span>
                <input
                  aria-label={`نام محور ${axisIndex + 1}`}
                  value={axis.name}
                  aria-invalid={Boolean(
                    axisError(props.axes, axisIndex, props.showErrors),
                  )}
                  onChange={(event) =>
                    props.onAxes(
                      updateAxis(props.axes, axisIndex, {
                        ...axis,
                        name: event.target.value,
                      }),
                    )
                  }
                  placeholder="مثلاً رنگ"
                />
                {axisError(props.axes, axisIndex, props.showErrors) ? (
                  <small className={styles.fieldError}>
                    {axisError(props.axes, axisIndex, props.showErrors)}
                  </small>
                ) : null}
              </label>
              {axis.values.map((value, valueIndex) => (
                <div className={styles.inlineField} key={value.clientKey}>
                  <label className={styles.field}>
                    <span>مقدار {valueIndex + 1}</span>
                    <input
                      aria-label={`مقدار ${valueIndex + 1} محور ${axisIndex + 1}`}
                      value={value.name}
                      aria-invalid={Boolean(
                        axisValueError(axis, valueIndex, props.showErrors),
                      )}
                      onChange={(event) => {
                        const values = axis.values.map((candidate, index) =>
                          index === valueIndex
                            ? { ...candidate, name: event.target.value }
                            : candidate,
                        );
                        props.onAxes(
                          updateAxis(props.axes, axisIndex, { ...axis, values }),
                        );
                      }}
                      placeholder="مثلاً زرشکی"
                    />
                    {axisValueError(axis, valueIndex, props.showErrors) ? (
                      <small className={styles.fieldError}>
                        {axisValueError(axis, valueIndex, props.showErrors)}
                      </small>
                    ) : null}
                  </label>
                  {axis.values.length > 1 ? (
                    <button
                      type="button"
                      className={styles.textButton}
                      aria-label={`حذف مقدار ${valueIndex + 1} محور ${axisIndex + 1}`}
                      onClick={() =>
                        props.onAxes(
                          updateAxis(props.axes, axisIndex, {
                            ...axis,
                            values: axis.values.filter(
                              (_, index) => index !== valueIndex,
                            ),
                          }),
                        )
                      }
                    >
                      حذف
                    </button>
                  ) : null}
                </div>
              ))}
              <button
                type="button"
                className={styles.textButton}
                onClick={() =>
                  props.onAxes(
                    updateAxis(props.axes, axisIndex, {
                      ...axis,
                      values: [...axis.values, newAxisValue()],
                    }),
                  )
                }
              >
                افزودن مقدار
              </button>
            </fieldset>
          ))}
          {props.axes.length < 2 ? (
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={() => props.onAxes([...props.axes, newAxis()])}
            >
              افزودن محور دوم
            </button>
          ) : null}
          {props.axes.length > 1 ? (
            <button
              type="button"
              className={styles.textButton}
              onClick={() => props.onAxes(props.axes.slice(0, -1))}
            >
              حذف محور دوم
            </button>
          ) : null}
          <p className={styles.count} aria-live="polite">
            {props.variantCount.toLocaleString("fa-IR")} گونه ساخته می‌شود
          </p>
        </div>
      ) : null}
    </section>
  );
}

function SaleStep(props: {
  kind: "simple" | "multi";
  axes: Axis[];
  variantCount: number;
  variants: VariantDraft[];
  rows: Record<string, SaleRow>;
  pending: boolean;
  showErrors: boolean;
  onKind: (kind: "simple" | "multi") => void;
  onAxes: (axes: Axis[]) => void;
  onRows: (rows: Record<string, SaleRow>) => void;
  onBack: () => void;
  onContinue: () => void;
}) {
  return (
    <>
      <h1>فروش کالا</h1>
      <p>ساختار انتخاب، قیمت و موجودی هر گونه را یک‌جا ثبت کنید.</p>
      <VariantFields
        kind={props.kind}
        axes={props.axes}
        variantCount={props.variantCount}
        showErrors={props.showErrors}
        onKind={props.onKind}
        onAxes={props.onAxes}
      />
      <div className={styles.variantList}>
        {props.variants.map((variant, index) => {
          const row = props.rows[variant.clientKey] ?? {
            priceToman: "",
            sku: "",
            onHand: "0",
            inventoryRevision: 0,
          };
          const label = variantLabel(variant, props.axes) || "گونه اصلی";
          const priceError = salePriceError(row.priceToman, props.showErrors);
          const stockError = saleStockError(row.onHand, props.showErrors);
          const update = (next: Partial<SaleRow>) =>
            props.onRows({ ...props.rows, [variant.clientKey]: { ...row, ...next } });
          return (
            <fieldset className={styles.variant} key={variant.clientKey}>
              <legend>{label}</legend>
              <label className={styles.field}>
                <span>قیمت به تومان</span>
                <input
                  aria-label={`قیمت ${label}`}
                  inputMode="numeric"
                  value={row.priceToman}
                  aria-invalid={Boolean(priceError)}
                  onChange={(event) => update({ priceToman: event.target.value })}
                />
                {priceError ? (
                  <small className={styles.fieldError}>{priceError}</small>
                ) : null}
              </label>
              <label className={styles.field}>
                <span>شناسه فروشنده (اختیاری)</span>
                <input
                  aria-label={`شناسه فروشنده ${label}`}
                  value={row.sku}
                  onChange={(event) => update({ sku: event.target.value })}
                />
              </label>
              <label className={styles.field}>
                <span>موجودی</span>
                <input
                  aria-label={`موجودی ${label}`}
                  inputMode="numeric"
                  value={row.onHand}
                  aria-invalid={Boolean(stockError)}
                  onChange={(event) => update({ onHand: event.target.value })}
                />
                {stockError ? (
                  <small className={styles.fieldError}>{stockError}</small>
                ) : null}
              </label>
              <span className={styles.rowNumber}>گونه {index + 1}</span>
            </fieldset>
          );
        })}
      </div>
      <div className={styles.actions}>
        <button
          className={styles.secondaryButton}
          disabled={props.pending}
          onClick={props.onBack}
        >
          برگشت
        </button>
        <button
          className={styles.primaryButton}
          disabled={props.pending}
          onClick={props.onContinue}
        >
          {props.pending ? "در حال ذخیره…" : "دیدن پیش‌نمایش"}
        </button>
      </div>
    </>
  );
}

function ProductPreview({ product }: { product: PublicProduct }) {
  return (
    <article className={styles.preview}>
      <img src={`/api/store/media/${product.images[0]!.id}`} alt={product.name} />
      <div>
        <h2>{product.name}</h2>
        <p>{product.description}</p>
        <strong>{formatPriceRange(product)}</strong>
        <span className={styles.availability}>
          {product.availability === "AVAILABLE" ? "موجود" : "ناموجود"}
        </span>
        {product.variants.length > 1 ? (
          <ul className={styles.previewVariants}>
            {product.variants.map((variant) => (
              <li key={variant.variantId}>
                <span>{variant.combination.map((part) => part.value).join("، ")}</span>
                <span>
                  {formatIrrAsToman(variant.price.amount)} ·{" "}
                  {variant.availability === "AVAILABLE" ? "موجود" : "ناموجود"}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </article>
  );
}

function buildVariants(axes: Axis[]): VariantDraft[] {
  if (axes.length === 0) return [{ clientKey: "simple", combination: [] }];
  if (axes.some((axis) => axis.values.length === 0)) return [];
  return axes.reduce<VariantDraft[]>(
    (variants, axis) =>
      variants.flatMap((variant) =>
        axis.values.map((value) => ({
          clientKey: `variant:${[...variant.combination.map((entry) => entry.valueClientKey), value.clientKey].sort().join(":")}`,
          combination: [
            ...variant.combination,
            { axisClientKey: axis.clientKey, valueClientKey: value.clientKey },
          ],
        })),
      ),
    [{ clientKey: "variant", combination: [] }],
  );
}

function variantLabel(variant: VariantDraft, axes: Axis[]) {
  return variant.combination
    .map(
      (selection) =>
        axes
          .find((axis) => axis.clientKey === selection.axisClientKey)
          ?.values.find((value) => value.clientKey === selection.valueClientKey)?.name,
    )
    .filter(Boolean)
    .join("، ");
}
function newAxis(): Axis {
  return { clientKey: crypto.randomUUID(), name: "", values: [newAxisValue()] };
}
function newAxisValue(): AxisValue {
  return { clientKey: crypto.randomUUID(), name: "" };
}
function updateAxis(axes: Axis[], index: number, axis: Axis) {
  return axes.map((candidate, candidateIndex) =>
    candidateIndex === index ? axis : candidate,
  );
}
function validAxes(axes: Axis[]) {
  const unique = (values: string[]) => new Set(values).size === values.length;
  return (
    axes.length > 0 &&
    unique(axes.map((axis) => axis.clientKey)) &&
    unique(axes.map((axis) => normalizeLabel(axis.name))) &&
    axes.every(
      (axis) =>
        axis.name.trim() &&
        axis.values.length > 0 &&
        axis.values.every((value) => value.name.trim()) &&
        unique(axis.values.map((value) => value.clientKey)) &&
        unique(axis.values.map((value) => normalizeLabel(value.name))),
    )
  );
}

function axisError(axes: Axis[], index: number, showErrors: boolean) {
  const axis = axes[index]!;
  if (showErrors && !axis.name.trim()) return "نام محور را وارد کنید.";
  const normalized = normalizeLabel(axis.name);
  if (
    normalized &&
    axes.some(
      (candidate, candidateIndex) =>
        candidateIndex !== index && normalizeLabel(candidate.name) === normalized,
    )
  ) {
    return "این نام محور تکراری است.";
  }
  return "";
}

function axisValueError(axis: Axis, index: number, showErrors: boolean) {
  const value = axis.values[index]!;
  if (showErrors && !value.name.trim()) return "مقدار را وارد کنید.";
  const normalized = normalizeLabel(value.name);
  if (
    normalized &&
    axis.values.some(
      (candidate, candidateIndex) =>
        candidateIndex !== index && normalizeLabel(candidate.name) === normalized,
    )
  ) {
    return "این مقدار در همین محور تکراری است.";
  }
  return "";
}

function salePriceError(value: string, showErrors: boolean) {
  if (!showErrors && !value) return "";
  return tomanToMoney(value) ? "" : "قیمت باید عدد صحیح و مثبت باشد.";
}

function saleStockError(value: string, showErrors: boolean) {
  if (!showErrors && !value) return "";
  return Number.isInteger(Number(value)) && Number(value) >= 0
    ? ""
    : "موجودی باید عدد صحیح و نامنفی باشد.";
}

function normalizeLabel(value: string) {
  return value.trim().replace(/\s+/gu, " ").toLocaleLowerCase("fa");
}

function readinessGuidance(path: string): {
  step: Step;
  message: string;
  action: string;
} {
  if (
    path === "workingCopy" ||
    path === "name" ||
    path === "description" ||
    path.startsWith("details.")
  ) {
    return {
      step: "details",
      message: "نام و توضیح کالا را کامل کنید.",
      action: "رفتن به مشخصات",
    };
  }
  if (path === "images" || path.startsWith("images.")) {
    return {
      step: "images",
      message: "یک تصویر برای کالا انتخاب کنید.",
      action: "رفتن به تصویر",
    };
  }
  return {
    step: "sale",
    message: path.endsWith(".price")
      ? "برای این گونه قیمت وارد کنید."
      : path.endsWith(".inventory")
        ? "موجودی این گونه را ثبت کنید."
        : "اطلاعات فروش گونه‌ها را کامل کنید.",
    action: "رفتن به فروش و موجودی",
  };
}

function redirectIfUnauthorized(response: Response) {
  if (response.status !== 401) return false;
  window.location.assign("/seller/login?returnTo=%2Fseller%2Fproducts%2Fnew");
  return true;
}
function tomanToMoney(value: string) {
  if (!/^\d+$/u.test(value)) return null;
  const amount = Number(value) * 10;
  return Number.isSafeInteger(amount) && amount > 0
    ? { amount, currency: "IRR" as const }
    : null;
}
function parseStock(value: string) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}

async function fetchWriteWithRetry(input: RequestInfo | URL, init: RequestInit) {
  return fetchWithRetry(input, init);
}

async function fetchWithRetry(input: RequestInfo | URL, init: RequestInit) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), WRITE_TIMEOUT_MS);
    try {
      const response = await fetch(input, { ...init, signal: controller.signal });
      if (![502, 503, 504].includes(response.status) || attempt === 2) {
        return response;
      }
    } catch (error) {
      lastError = error;
    } finally {
      window.clearTimeout(timeout);
    }
    await new Promise((resolve) => window.setTimeout(resolve, 120));
  }
  throw lastError instanceof Error
    ? new Error("پاسخ سرور به‌موقع نرسید. دوباره تلاش کنید.", { cause: lastError })
    : new Error("پاسخ سرور به‌موقع نرسید. دوباره تلاش کنید.");
}
function formatPriceRange(product: PublicProduct) {
  return product.priceRange.minimum.amount === product.priceRange.maximum.amount
    ? formatIrrAsToman(product.priceRange.minimum.amount)
    : `از ${formatIrrAsToman(product.priceRange.minimum.amount)} تا ${formatIrrAsToman(product.priceRange.maximum.amount)}`;
}

async function uploadProductImage(productId: string, file: File): Promise<MediaId> {
  if (file.size > MEDIA_UPLOAD_MAX_BYTES)
    throw new Error("حجم تصویر باید حداکثر ۱۰ مگابایت باشد.");
  if (!(MEDIA_UPLOAD_ACCEPTED_TYPES as readonly string[]).includes(file.type))
    throw new Error("فقط تصویر JPEG، PNG یا WebP پذیرفته می‌شود.");
  const form = new FormData();
  form.set("purpose", "PRODUCT_IMAGE");
  form.set("file", file, file.name);
  const response = await fetch(`/api/store/seller/products/${productId}/images`, {
    method: "POST",
    body: form,
  });
  const body: unknown = await response.json();
  const parsed = mediaReferenceContract.safeParse(body);
  if (!response.ok || !parsed.success)
    throw new Error(humanError(body, "بارگذاری تصویر انجام نشد."));
  return parsed.data.id;
}

function persistentCreateKey() {
  const existing = sessionStorage.getItem(CREATE_KEY_STORAGE);
  if (existing) return existing;
  const created = crypto.randomUUID();
  sessionStorage.setItem(CREATE_KEY_STORAGE, created);
  return created;
}
function requestKey(reference: RequestRef, payload: unknown) {
  const serialized = JSON.stringify(payload);
  if (reference.current?.payload === serialized) return reference.current.key;
  const key = crypto.randomUUID();
  reference.current = { payload: serialized, key };
  return key;
}
function writeHeaders(revision: number, idempotencyKey: string) {
  return {
    "content-type": "application/json",
    "idempotency-key": idempotencyKey,
    "if-match": `"${revision}"`,
  };
}
function stepLabel(step: Step) {
  return step === "details"
    ? "۱"
    : step === "images"
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
