"use client";

import {
  productBatchResultContract,
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
import { axisValueErrorId, domIdPart } from "./product-builder-dom";
import {
  applyRevisionConflictChoices,
  buildRevisionConflictReview,
  type ConflictChoice,
  type ProductAuthoringSnapshot,
  type ProductConflictScope,
  type RevisionConflictItem,
  type RevisionConflictKey,
  type RevisionConflictReview,
} from "./product-conflict-reconciliation";

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
type ImageDraft = {
  key: string;
  mediaId?: MediaId;
  file?: File;
  uploadKey?: string;
};
type IdempotentRequest = { payload: string; key: string };
type RequestRef = { current: IdempotentRequest | undefined };
type ProductIssue = { path: string; code: string };
type RevisionConflictState = {
  authoritative: ProductView;
  review: RevisionConflictReview;
};

const PRODUCT_ID_STORAGE = "sevo-product-authoring-id";
const CREATE_KEY_STORAGE = "sevo-product-authoring-create-key";
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
  const [images, setImages] = useState<ImageDraft[]>([]);
  const [kind, setKind] = useState<"simple" | "multi">("simple");
  const [axes, setAxes] = useState<Axis[]>([]);
  const [saleRows, setSaleRows] = useState<Record<string, SaleRow>>({});
  const [preview, setPreview] = useState<PublicProduct>();
  const [issues, setIssues] = useState<ProductIssue[]>([]);
  const [message, setMessage] = useState("");
  const [revisionConflict, setRevisionConflict] = useState<RevisionConflictState>();
  const [conflictChoices, setConflictChoices] = useState<
    Partial<Record<RevisionConflictKey, ConflictChoice>>
  >({});
  const [showDetailsErrors, setShowDetailsErrors] = useState(false);
  const [showImageError, setShowImageError] = useState(false);
  const [showSaleErrors, setShowSaleErrors] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const saveRequest = useRef<IdempotentRequest | undefined>(undefined);
  const offersRequest = useRef<IdempotentRequest | undefined>(undefined);
  const inventoryRequest = useRef<IdempotentRequest | undefined>(undefined);
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
      if (redirectIfUnauthorized(slugResponse, requestedProductId)) return;
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
        if (redirectIfUnauthorized(response, requestedProductId)) return;
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
      if (redirectIfUnauthorized(response, requestedProductId)) return;
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
    if (!product.workingCopy) return;
    setName(product.workingCopy.name ?? "");
    setDescription(product.workingCopy.description);
    setImages(
      product.workingCopy.orderedMediaIds.map((mediaId) => ({
        key: mediaId,
        mediaId,
      })),
    );
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

  async function openRevisionConflict(
    scope: ProductConflictScope,
    local: ProductAuthoringSnapshot,
  ) {
    const response = await fetch(`/api/store/seller/products/${productId}`, {
      cache: "no-store",
    });
    const body: unknown = await response.json();
    const parsed = productViewContract.safeParse(body);
    if (!response.ok || !parsed.success) {
      throw new Error(
        humanError(body, "خواندن نسخه تازه کالا انجام نشد. دوباره تلاش کنید."),
      );
    }
    const review = buildRevisionConflictReview(
      scope,
      local,
      authoringSnapshotFromProduct(parsed.data),
    );
    setConflictChoices(
      review.items.some((item) => item.key === "revision")
        ? { revision: "server" }
        : {},
    );
    setRevisionConflict({ authoritative: parsed.data, review });
  }

  function applyReviewedConflict() {
    if (!revisionConflict) return;
    if (
      revisionConflict.review.items.some(
        (item) => conflictChoices[item.key] === undefined,
      )
    ) {
      return;
    }
    const merged = applyRevisionConflictChoices(
      revisionConflict.review,
      conflictChoices,
    );
    hydrate(revisionConflict.authoritative);
    setName(merged.name);
    setDescription(merged.description);
    setImages(
      merged.orderedMediaIds.map((mediaId) => ({
        key: mediaId,
        mediaId: mediaId as MediaId,
      })),
    );
    setAxes(merged.axes);
    setKind(merged.axes.length === 0 ? "simple" : "multi");
    setSaleRows(
      Object.fromEntries(
        merged.variants.map((variant) => [
          variant.clientKey,
          {
            variantId: variant.variantId,
            priceToman: variant.priceToman,
            sku: variant.sku,
            onHand: variant.onHand,
            inventoryRevision: variant.inventoryRevision,
          },
        ]),
      ),
    );
    setRevisionConflict(undefined);
    setConflictChoices({});
    setMessage("انتخاب‌ها روی نسخه تازه آماده شد. اکنون دوباره ذخیره کنید.");
  }

  function cancelConflictReview() {
    setRevisionConflict(undefined);
    setConflictChoices({});
    setMessage("تغییرهای شما دست‌نخورده ماند. برای ذخیره، نسخه تازه را بازبینی کنید.");
  }

  async function saveWorkingCopy(
    options: {
      uploadImage?: boolean;
      applyLiveSale?: boolean;
    } = {},
  ) {
    const desiredRows = saleRows;
    let effectiveImages = images;
    if (options.uploadImage && images.some((entry) => entry.file)) {
      effectiveImages = [...images];
      for (const [index, entry] of effectiveImages.entries()) {
        if (!entry.file) continue;
        const uploadKey = entry.uploadKey ?? crypto.randomUUID();
        effectiveImages[index] = { ...entry, uploadKey };
        setImages([...effectiveImages]);
        const mediaId = await uploadProductImage(productId, entry.file, uploadKey);
        effectiveImages[index] = { key: entry.key, mediaId };
        setImages([...effectiveImages]);
      }
    }
    const currentVariants = buildVariants(kind === "simple" ? [] : axes);
    const payload = {
      expectedRevision: revision,
      workingCopy: {
        name: name.trim().length >= 2 ? name : null,
        description,
        orderedMediaIds: effectiveImages.flatMap((entry) =>
          entry.mediaId ? [entry.mediaId] : [],
        ),
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
      inventory:
        productState === "DRAFT"
          ? {
              rows: currentVariants.map((variant) => {
                const sale = saleRows[variant.clientKey];
                return {
                  variantClientKey: variant.clientKey,
                  onHand: parseStock(sale?.onHand ?? "0"),
                  expectedRevision: sale?.inventoryRevision ?? 0,
                };
              }),
            }
          : null,
    };
    const localSnapshot = authoringSnapshotFromEditor({
      name,
      description,
      images: effectiveImages,
      axes: kind === "simple" ? [] : axes,
      variants: currentVariants,
      rows: desiredRows,
    });
    const response = await fetchWithRetry(
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
      if (isRevisionConflict(body)) {
        await openRevisionConflict("working-copy", localSnapshot);
        throw new RevisionConflictHandledError();
      }
      setIssues(apiIssues(body));
      throw new Error(humanError(body, "ذخیره پیش‌نویس انجام نشد."));
    }
    if (productState === "DRAFT" || !options.applyLiveSale) {
      hydrate(parsed.data);
      if (productState !== "DRAFT") setSaleRows(desiredRows);
      return parsed.data;
    }
    return saveLiveSaleBatches(parsed.data, desiredRows);
  }

  async function saveLiveSaleBatches(
    product: ProductView,
    desiredRows: Record<string, SaleRow>,
  ) {
    const workingCopy = product.workingCopy;
    if (!workingCopy) return product;
    const offerPayload = {
      expectedRevision: product.revision,
      rows: workingCopy.variants.map((variant) => ({
        variantId: variant.variantId,
        price: tomanToMoney(desiredRows[variant.clientKey]!.priceToman)!,
        sku: desiredRows[variant.clientKey]!.sku.trim() || null,
        expectedRevision: variant.offerRevision,
      })),
    };
    const offerResponse = await fetchWithRetry(
      `/api/store/seller/products/${productId}/offers`,
      {
        method: "PUT",
        headers: writeHeaders(
          product.revision,
          requestKey(offersRequest, offerPayload),
        ),
        body: JSON.stringify(offerPayload),
      },
    );
    const offerBody: unknown = await offerResponse.json();
    const offerResult = productBatchResultContract.safeParse(offerBody);
    if (!offerResponse.ok || !offerResult.success) {
      if (isRevisionConflict(offerBody)) {
        await openRevisionConflict(
          "offers",
          authoringSnapshotFromProduct(product, desiredRows),
        );
        throw new RevisionConflictHandledError();
      }
      setIssues(apiIssues(offerBody));
      throw new Error(humanError(offerBody, "ذخیره قیمت و شناسه‌ها انجام نشد."));
    }
    const inventoryByVariant = new Map(
      product.inventory.map((row) => [row.variantId, row] as const),
    );
    const inventoryPayload = {
      expectedRevision: offerResult.data.productRevision,
      reasonCode: "MANUAL_COUNT",
      rows: workingCopy.variants.map((variant) => ({
        variantId: variant.variantId,
        onHand: parseStock(desiredRows[variant.clientKey]!.onHand),
        expectedRevision: inventoryByVariant.get(variant.variantId)?.revision ?? 0,
      })),
    };
    const inventoryResponse = await fetchWithRetry(
      `/api/store/seller/products/${productId}/inventory`,
      {
        method: "PUT",
        headers: writeHeaders(
          offerResult.data.productRevision,
          requestKey(inventoryRequest, inventoryPayload),
        ),
        body: JSON.stringify(inventoryPayload),
      },
    );
    const inventoryBody: unknown = await inventoryResponse.json();
    const inventoryResult = productBatchResultContract.safeParse(inventoryBody);
    if (!inventoryResponse.ok || !inventoryResult.success) {
      if (isRevisionConflict(inventoryBody)) {
        await openRevisionConflict(
          "inventory",
          authoringSnapshotFromProduct(product, desiredRows),
        );
        throw new RevisionConflictHandledError();
      }
      setIssues(apiIssues(inventoryBody));
      throw new Error(humanError(inventoryBody, "ذخیره موجودی انجام نشد."));
    }
    const refreshed = await fetch(`/api/store/seller/products/${productId}`, {
      cache: "no-store",
    });
    const refreshedBody: unknown = await refreshed.json();
    const parsed = productViewContract.safeParse(refreshedBody);
    if (!refreshed.ok || !parsed.success) {
      throw new Error(
        humanError(refreshedBody, "خواندن تغییرهای ذخیره‌شده انجام نشد."),
      );
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
    if (images.length === 0 || images.length > 6) return setMessage("");
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
      await saveWorkingCopy({ applyLiveSale: true });
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

  async function backTo(next: Step) {
    if (!validateDraftExit()) return;
    await runPending(async () => {
      await saveWorkingCopy({
        uploadImage: step === "images" && images.some((entry) => entry.file),
      });
      setStep(next);
    });
  }

  async function publish() {
    await runPending(async () => {
      const payload = { expectedRevision: revision, confirmed: true };
      const response = await fetchWithRetry(
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
      sessionStorage.removeItem(PRODUCT_ID_STORAGE);
      sessionStorage.removeItem(CREATE_KEY_STORAGE);
      setStep("published");
    });
  }

  async function unpublish() {
    await runPending(async () => {
      const payload = { expectedRevision: revision, reasonCode: "SELLER_REQUEST" };
      const response = await fetchWithRetry(
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
    if (!validateDraftExit()) return;
    await runPending(async () => {
      await saveWorkingCopy({
        uploadImage: images.some((entry) => entry.file),
        applyLiveSale: step === "sale",
      });
      window.location.assign("/seller/products");
    });
  }

  async function saveDraftAndExit() {
    if (!validateDraftExit()) return;
    if (
      step === "sale" &&
      productState !== "DRAFT" &&
      !window.confirm(
        "تغییرهای قیمت و موجودی اعمال نمی‌شوند. بدون اعمال فروش خارج می‌شوید؟",
      )
    ) {
      return;
    }
    await runPending(async () => {
      await saveWorkingCopy({ uploadImage: images.some((entry) => entry.file) });
      window.location.assign("/seller/products");
    });
  }

  function validateDraftExit() {
    if (name.trim().length === 1) {
      setShowDetailsErrors(true);
      setStep("details");
      setMessage("نام کالا را کامل کنید.");
      return false;
    }
    if (step !== "sale") return true;
    const hasInvalidRow = variants.some((variant) => {
      const row = saleRows[variant.clientKey];
      const price = row?.priceToman ?? "";
      const stock = row?.onHand ?? "";
      return (
        (price.length > 0 && !tomanToMoney(price)) ||
        (stock.length > 0 && saleStockError(stock, true).length > 0)
      );
    });
    if ((kind === "multi" && !validAxes(axes)) || hasInvalidRow) {
      setShowSaleErrors(true);
      setMessage("مقدارهای مشخص‌شده را پیش از خروج بررسی کنید.");
      return false;
    }
    return true;
  }

  async function runPending(action: () => Promise<void>) {
    setPending(true);
    setMessage("");
    try {
      await action();
    } catch (error) {
      if (!(error instanceof RevisionConflictHandledError)) {
        setMessage(error instanceof Error ? error.message : "تغییر ذخیره نشد.");
      }
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
  if (revisionConflict) {
    const choicesComplete = revisionConflict.review.items.every(
      (item) => conflictChoices[item.key] !== undefined,
    );
    return (
      <main className={styles.page}>
        <section className={styles.workspace} aria-live="polite">
          <span className={styles.brand}>سوو</span>
          <h1>تغییرهای هم‌زمان را بازبینی کنید</h1>
          <p>{conflictIntro(revisionConflict.review.scope)}</p>
          <div className={styles.conflictList}>
            {revisionConflict.review.items.map((item) =>
              item.key === "revision" ? (
                <section className={styles.conflictItem} key={item.key}>
                  <h2>{item.title}</h2>
                  <p>{item.serverSummary}</p>
                </section>
              ) : (
                <fieldset className={styles.conflictItem} key={item.key}>
                  <legend>{item.title}</legend>
                  <label
                    className={
                      conflictChoices[item.key] === "local"
                        ? styles.conflictOptionSelected
                        : styles.conflictOption
                    }
                  >
                    <input
                      type="radio"
                      name={`conflict-${domIdPart(item.key)}`}
                      checked={conflictChoices[item.key] === "local"}
                      onChange={() =>
                        setConflictChoices((current) => ({
                          ...current,
                          [item.key]: "local",
                        }))
                      }
                    />
                    <ConflictChoiceContent item={item} source="local" />
                  </label>
                  <label
                    className={
                      conflictChoices[item.key] === "server"
                        ? styles.conflictOptionSelected
                        : styles.conflictOption
                    }
                  >
                    <input
                      type="radio"
                      name={`conflict-${domIdPart(item.key)}`}
                      checked={conflictChoices[item.key] === "server"}
                      onChange={() =>
                        setConflictChoices((current) => ({
                          ...current,
                          [item.key]: "server",
                        }))
                      }
                    />
                    <ConflictChoiceContent item={item} source="server" />
                  </label>
                </fieldset>
              ),
            )}
          </div>
          <p className={styles.liveChangeNotice}>
            هیچ تغییری هنوز جایگزین نشده است. پس از انتخاب، نسخه ادغام‌شده را یک بار
            دیگر ذخیره می‌کنید.
          </p>
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={cancelConflictReview}
            >
              بازگشت به ویرایش
            </button>
            <button
              type="button"
              className={styles.primaryButton}
              disabled={!choicesComplete}
              onClick={applyReviewedConflict}
            >
              آماده‌کردن تغییرهای انتخاب‌شده
            </button>
          </div>
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
          <button
            type="button"
            className={styles.textButton}
            disabled={pending}
            onClick={saveDraftAndExit}
          >
            {step === "sale" && productState !== "DRAFT"
              ? "خروج بدون اعمال فروش"
              : "بازگشت به کالاها"}
          </button>
          <span className={styles.progress}>{stepLabel(step)} از ۴</span>
          <button
            type="button"
            className={styles.textButton}
            disabled={pending}
            onClick={saveAndExit}
          >
            {step === "sale" && productState !== "DRAFT"
              ? "اعمال فروش و خروج"
              : "ذخیره و خروج"}
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
            images={images}
            pending={pending}
            showError={showImageError}
            onImages={setImages}
            onBack={() => backTo("details")}
            onContinue={continueFromImages}
          />
        ) : null}
        {step === "sale" ? (
          <SaleStep
            productState={productState}
            kind={kind}
            axes={axes}
            variantCount={variants.length}
            variants={variants}
            rows={saleRows}
            pending={pending}
            showErrors={showSaleErrors}
            issues={issues}
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

function ConflictChoiceContent({
  item,
  source,
}: {
  item: RevisionConflictItem;
  source: "local" | "server";
}) {
  const title = source === "local" ? "تغییر من" : "نسخه تازه";
  const summary = source === "local" ? item.localSummary : item.serverSummary;
  const mediaIds =
    item.kind === "images"
      ? source === "local"
        ? item.localMediaIds
        : item.serverMediaIds
      : [];
  return (
    <span>
      <strong>{title}</strong>
      {mediaIds.length > 0 ? (
        <span className={styles.conflictImages} aria-label={`تصویرهای ${title}`}>
          {mediaIds.map((mediaId, index) => (
            <img
              key={mediaId}
              src={`/api/store/media/${mediaId}`}
              alt={`تصویر ${index + 1} در ${title}`}
            />
          ))}
        </span>
      ) : null}
      <small>{summary}</small>
    </span>
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
  images: ImageDraft[];
  pending: boolean;
  showError: boolean;
  onImages: (value: ImageDraft[]) => void;
  onBack: () => void;
  onContinue: () => void;
}) {
  const missing = props.showError && props.images.length === 0;
  const tooMany = props.images.length > 6;
  const move = (from: number, to: number) => {
    const next = [...props.images];
    const [entry] = next.splice(from, 1);
    next.splice(to, 0, entry!);
    props.onImages(next);
  };
  return (
    <>
      <h1>تصویرهای کالا</h1>
      <p>یک تا شش تصویر انتخاب کنید؛ تصویر نخست، تصویر اصلی فروشگاه است.</p>
      <label className={styles.filePicker}>
        <span>انتخاب تصویر کالا</span>
        <input
          type="file"
          multiple
          accept={MEDIA_UPLOAD_ACCEPTED_TYPES.join(",")}
          aria-invalid={missing || tooMany}
          aria-describedby={missing || tooMany ? "product-image-error" : undefined}
          onChange={(event) => {
            const selected = Array.from(event.target.files ?? []).map((file) => ({
              key: crypto.randomUUID(),
              file,
              uploadKey: crypto.randomUUID(),
            }));
            props.onImages([...props.images, ...selected]);
            event.target.value = "";
          }}
        />
        <small>
          {props.images.length > 0
            ? `${props.images.length.toLocaleString("fa-IR")} تصویر انتخاب شده است`
            : "تصویری انتخاب نشده است"}
        </small>
        {missing || tooMany ? (
          <small className={styles.fieldError} id="product-image-error">
            {tooMany
              ? "حداکثر شش تصویر می‌توانید انتخاب کنید."
              : "دست‌کم یک تصویر برای کالا انتخاب کنید."}
          </small>
        ) : null}
      </label>
      {props.images.length > 0 ? (
        <ol className={styles.imageList} aria-label="ترتیب تصویرهای کالا">
          {props.images.map((entry, index) => (
            <li key={entry.key}>
              <span>
                {index === 0 ? "تصویر اصلی" : `تصویر ${index + 1}`}
                {entry.file ? ` — ${entry.file.name}` : " — ذخیره شده"}
              </span>
              <div className={styles.imageActions}>
                {index > 0 ? (
                  <button
                    type="button"
                    className={styles.textButton}
                    aria-label={`انتقال تصویر ${index + 1} به ابتدا`}
                    onClick={() => move(index, 0)}
                  >
                    اصلی شود
                  </button>
                ) : null}
                <button
                  type="button"
                  className={styles.textButton}
                  aria-label={`حذف تصویر ${index + 1}`}
                  onClick={() =>
                    props.onImages(
                      props.images.filter((candidate) => candidate.key !== entry.key),
                    )
                  }
                >
                  حذف
                </button>
              </div>
            </li>
          ))}
        </ol>
      ) : null}
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
        <label
          className={props.kind === "simple" ? styles.choiceActive : styles.choice}
        >
          <input
            type="radio"
            name="variant-kind"
            checked={props.kind === "simple"}
            onChange={() => props.onKind("simple")}
          />
          یک گونه
        </label>
        <label className={props.kind === "multi" ? styles.choiceActive : styles.choice}>
          <input
            type="radio"
            name="variant-kind"
            checked={props.kind === "multi"}
            onChange={() => props.onKind("multi")}
          />
          چندگونه
        </label>
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
                  aria-describedby={
                    axisError(props.axes, axisIndex, props.showErrors)
                      ? `axis-name-error-${domIdPart(axis.clientKey)}`
                      : undefined
                  }
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
                  <small
                    className={styles.fieldError}
                    id={`axis-name-error-${domIdPart(axis.clientKey)}`}
                  >
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
                      aria-describedby={
                        axisValueError(axis, valueIndex, props.showErrors)
                          ? axisValueErrorId(axis.clientKey, value.clientKey)
                          : undefined
                      }
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
                      <small
                        className={styles.fieldError}
                        id={axisValueErrorId(axis.clientKey, value.clientKey)}
                      >
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
  productState: ProductView["state"];
  kind: "simple" | "multi";
  axes: Axis[];
  variantCount: number;
  variants: VariantDraft[];
  rows: Record<string, SaleRow>;
  pending: boolean;
  showErrors: boolean;
  issues: ProductIssue[];
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
      {props.productState === "PUBLISHED" ? (
        <p className={styles.liveChangeNotice}>
          با ادامه، قیمت و موجودی تازه همان لحظه برای خریدار اعمال می‌شود؛ انتشار
          تغییرهای متن و تصویر جداگانه تأیید خواهد شد.
        </p>
      ) : props.productState === "UNPUBLISHED" ? (
        <p className={styles.liveChangeNotice}>
          قیمت و موجودی تازه اکنون ذخیره می‌شود و فقط پس از انتشار دوباره برای خریدار
          دیده خواهد شد.
        </p>
      ) : null}
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
          const producerPriceError = rowIssue(props.issues, index, "price");
          const producerSkuError = rowIssue(props.issues, index, "sku");
          const producerStockError = rowIssue(props.issues, index, "onHand");
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
                  aria-invalid={Boolean(priceError || producerPriceError)}
                  aria-describedby={
                    priceError || producerPriceError
                      ? `sale-price-error-${domIdPart(variant.clientKey)}`
                      : undefined
                  }
                  onChange={(event) => update({ priceToman: event.target.value })}
                />
                {priceError || producerPriceError ? (
                  <small
                    className={styles.fieldError}
                    id={`sale-price-error-${domIdPart(variant.clientKey)}`}
                  >
                    {priceError || producerPriceError}
                  </small>
                ) : null}
              </label>
              <label className={styles.field}>
                <span>شناسه فروشنده (اختیاری)</span>
                <input
                  aria-label={`شناسه فروشنده ${label}`}
                  value={row.sku}
                  aria-invalid={Boolean(producerSkuError)}
                  aria-describedby={
                    producerSkuError
                      ? `sale-sku-error-${domIdPart(variant.clientKey)}`
                      : undefined
                  }
                  onChange={(event) => update({ sku: event.target.value })}
                />
                {producerSkuError ? (
                  <small
                    className={styles.fieldError}
                    id={`sale-sku-error-${domIdPart(variant.clientKey)}`}
                  >
                    {producerSkuError}
                  </small>
                ) : null}
              </label>
              <label className={styles.field}>
                <span>موجودی</span>
                <input
                  aria-label={`موجودی ${label}`}
                  inputMode="numeric"
                  value={row.onHand}
                  aria-invalid={Boolean(stockError || producerStockError)}
                  aria-describedby={
                    stockError || producerStockError
                      ? `sale-stock-error-${domIdPart(variant.clientKey)}`
                      : undefined
                  }
                  onChange={(event) => update({ onHand: event.target.value })}
                />
                {stockError || producerStockError ? (
                  <small
                    className={styles.fieldError}
                    id={`sale-stock-error-${domIdPart(variant.clientKey)}`}
                  >
                    {stockError || producerStockError}
                  </small>
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
          {props.pending
            ? "در حال ذخیره…"
            : props.productState !== "DRAFT"
              ? "اعمال فروش و دیدن پیش‌نمایش"
              : "دیدن پیش‌نمایش"}
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

function redirectIfUnauthorized(response: Response, productId?: string) {
  if (response.status !== 401) return false;
  const returnTo = productId
    ? `/seller/products/${productId}/edit`
    : "/seller/products/new";
  window.location.assign(`/seller/login?returnTo=${encodeURIComponent(returnTo)}`);
  return true;
}

function authoringSnapshotFromEditor(input: {
  name: string;
  description: string;
  images: ImageDraft[];
  axes: Axis[];
  variants: VariantDraft[];
  rows: Record<string, SaleRow>;
}): ProductAuthoringSnapshot {
  return {
    name: input.name,
    description: input.description,
    orderedMediaIds: input.images.flatMap((image) =>
      image.mediaId ? [image.mediaId] : [],
    ),
    axes: input.axes,
    variants: input.variants.map((variant) => {
      const row = input.rows[variant.clientKey];
      return {
        ...variant,
        variantId: row?.variantId,
        priceToman: row?.priceToman ?? "",
        sku: row?.sku ?? "",
        onHand: row?.onHand ?? "0",
        inventoryRevision: row?.inventoryRevision ?? 0,
      };
    }),
  };
}

function authoringSnapshotFromProduct(
  product: ProductView,
  desiredRows?: Record<string, SaleRow>,
): ProductAuthoringSnapshot {
  const workingCopy = product.workingCopy;
  if (!workingCopy) {
    return {
      name: "",
      description: "",
      orderedMediaIds: [],
      axes: [],
      variants: [],
    };
  }
  const inventory = new Map(
    product.inventory.map((row) => [row.variantId, row] as const),
  );
  return {
    name: workingCopy.name ?? "",
    description: workingCopy.description,
    orderedMediaIds: workingCopy.orderedMediaIds,
    axes: workingCopy.axes,
    variants: workingCopy.variants.map((variant) => {
      const desired = desiredRows?.[variant.clientKey];
      const stock = inventory.get(variant.variantId);
      return {
        clientKey: variant.clientKey,
        variantId: variant.variantId,
        combination: variant.combination,
        priceToman:
          desired?.priceToman ??
          (variant.price ? String(variant.price.amount / 10) : ""),
        sku: desired?.sku ?? variant.sku ?? "",
        onHand: desired?.onHand ?? String(stock?.onHand ?? 0),
        inventoryRevision: stock?.revision ?? 0,
      };
    }),
  };
}

function conflictIntro(scope: ProductConflictScope) {
  return scope === "working-copy"
    ? "نسخه کاری کالا جای دیگری تغییر کرده است. برای هر بخش مشخص کنید کدام مقدار بماند."
    : scope === "offers"
      ? "قیمت یا شناسه گونه‌ها تازه‌تر شده است. انتخاب شما روی همان نسخه تازه اعمال می‌شود."
      : "موجودی گونه‌ها تازه‌تر شده است. مقدارهای محلی و تازه را پیش از ادامه مقایسه کنید.";
}

function isRevisionConflict(body: unknown) {
  return (
    typeof body === "object" &&
    body !== null &&
    "code" in body &&
    body.code === "REVISION_CONFLICT"
  );
}

class RevisionConflictHandledError extends Error {}

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

async function uploadProductImage(
  productId: string,
  file: File,
  uploadKey: string,
): Promise<MediaId> {
  if (file.size > MEDIA_UPLOAD_MAX_BYTES)
    throw new Error("حجم تصویر باید حداکثر ۱۰ مگابایت باشد.");
  if (!(MEDIA_UPLOAD_ACCEPTED_TYPES as readonly string[]).includes(file.type))
    throw new Error("فقط تصویر JPEG، PNG یا WebP پذیرفته می‌شود.");
  const form = new FormData();
  form.set("purpose", "PRODUCT_IMAGE");
  form.set("file", file, file.name);
  const response = await fetchWithRetry(
    `/api/store/seller/products/${productId}/images`,
    {
      method: "POST",
      headers: { "idempotency-key": uploadKey },
      body: form,
    },
  );
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

function apiIssues(body: unknown): ProductIssue[] {
  if (typeof body !== "object" || body === null || !("details" in body)) return [];
  const details = body.details as {
    issues?: Array<{ field?: string; path?: string; code?: string }>;
  };
  return (details.issues ?? []).flatMap((issue) => {
    const path = issue.path ?? issue.field;
    return path ? [{ path, code: issue.code ?? "INVALID" }] : [];
  });
}

function rowIssue(issues: ProductIssue[], index: number, field: string) {
  const matchesRow = (path: string) =>
    path.includes(`rows.${index}`) || path.includes(`rows[${index}]`);
  return issues.some(
    (issue) =>
      matchesRow(issue.path) && issue.path.toLowerCase().includes(field.toLowerCase()),
  )
    ? "این مقدار را بررسی کنید."
    : "";
}
