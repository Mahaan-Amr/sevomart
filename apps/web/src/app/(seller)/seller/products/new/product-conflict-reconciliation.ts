export type ProductConflictScope = "working-copy" | "offers" | "inventory";
export type ConflictChoice = "local" | "server";
export type RevisionConflictKey =
  | "name"
  | "description"
  | "images"
  | "structure"
  | "revision"
  | `offer-price:${string}`
  | `offer-sku:${string}`
  | `inventory:${string}`;

export type ProductAuthoringAxis = {
  clientKey: string;
  name: string;
  values: Array<{ clientKey: string; name: string }>;
};

export type ProductAuthoringVariant = {
  clientKey: string;
  variantId?: string;
  combination: Array<{ axisClientKey: string; valueClientKey: string }>;
  priceToman: string;
  sku: string;
  onHand: string;
  inventoryRevision: number;
};

export type ProductAuthoringSnapshot = {
  name: string;
  description: string;
  orderedMediaIds: string[];
  axes: ProductAuthoringAxis[];
  variants: ProductAuthoringVariant[];
};

type ValueConflictItem = {
  kind: "value";
  key: RevisionConflictKey;
  title: string;
  localSummary: string;
  serverSummary: string;
};

type ImageConflictItem = {
  kind: "images";
  key: "images";
  title: string;
  localSummary: string;
  serverSummary: string;
  localMediaIds: string[];
  serverMediaIds: string[];
};

export type RevisionConflictItem = ValueConflictItem | ImageConflictItem;

export type RevisionConflictReview = {
  scope: ProductConflictScope;
  local: ProductAuthoringSnapshot;
  server: ProductAuthoringSnapshot;
  items: RevisionConflictItem[];
};

export function buildRevisionConflictReview(
  scope: ProductConflictScope,
  local: ProductAuthoringSnapshot,
  server: ProductAuthoringSnapshot,
): RevisionConflictReview {
  const items: RevisionConflictItem[] = [];

  if (local.name !== server.name) {
    items.push({
      kind: "value",
      key: "name",
      title: "نام کالا",
      localSummary: textSummary(local.name, "بدون نام"),
      serverSummary: textSummary(server.name, "بدون نام"),
    });
  }

  if (local.description !== server.description) {
    items.push({
      kind: "value",
      key: "description",
      title: "توضیح کالا",
      localSummary: textSummary(local.description, "بدون توضیح"),
      serverSummary: textSummary(server.description, "بدون توضیح"),
    });
  }

  if (!same(local.orderedMediaIds, server.orderedMediaIds)) {
    items.push({
      kind: "images",
      key: "images",
      title: "تصویرهای کالا",
      localSummary: imageSummary(local.orderedMediaIds, "انتخاب شما"),
      serverSummary: imageSummary(server.orderedMediaIds, "نسخه تازه"),
      localMediaIds: [...local.orderedMediaIds],
      serverMediaIds: [...server.orderedMediaIds],
    });
  }

  if (!same(structureOf(local), structureOf(server))) {
    items.push({
      kind: "value",
      key: "structure",
      title: "ساختار گونه‌ها",
      localSummary: structureSummary(local),
      serverSummary: structureSummary(server),
    });
  }

  for (const localVariant of local.variants) {
    const serverVariant = findVariant(server, localVariant);
    if (!serverVariant) continue;
    const key = variantKey(localVariant);
    const label = variantLabel(local, localVariant);
    if (localVariant.priceToman !== serverVariant.priceToman) {
      items.push({
        kind: "value",
        key: `offer-price:${key}`,
        title: `قیمت ${label}`,
        localSummary: priceSummary(localVariant.priceToman),
        serverSummary: priceSummary(serverVariant.priceToman),
      });
    }
    if (localVariant.sku !== serverVariant.sku) {
      items.push({
        kind: "value",
        key: `offer-sku:${key}`,
        title: `شناسه ${label}`,
        localSummary: textSummary(localVariant.sku, "بدون شناسه"),
        serverSummary: textSummary(serverVariant.sku, "بدون شناسه"),
      });
    }
  }

  for (const localVariant of local.variants) {
    const serverVariant = findVariant(server, localVariant);
    if (!serverVariant || localVariant.onHand === serverVariant.onHand) continue;
    const key = variantKey(localVariant);
    items.push({
      kind: "value",
      key: `inventory:${key}`,
      title: `موجودی ${variantLabel(local, localVariant)}`,
      localSummary: inventorySummary(localVariant),
      serverSummary: inventorySummary(serverVariant),
    });
  }

  if (items.length === 0) {
    items.push({
      kind: "value",
      key: "revision",
      title: "نسخه تازه کالا",
      localSummary: "محتوای تغییرهای شما با نسخه تازه یکسان است.",
      serverSummary: "نسخه تازه برای ادامه کار خوانده شد.",
    });
  }

  return { scope, local, server, items };
}

export function applyRevisionConflictChoices(
  review: RevisionConflictReview,
  choices: Partial<Record<RevisionConflictKey, ConflictChoice>>,
): ProductAuthoringSnapshot {
  const merged = cloneSnapshot(review.server);

  if (choices.name === "local") {
    merged.name = review.local.name;
  }
  if (choices.description === "local") {
    merged.description = review.local.description;
  }
  if (choices.images === "local") {
    merged.orderedMediaIds = [...review.local.orderedMediaIds];
  }
  if (choices.structure === "local") {
    merged.axes = cloneSnapshot(review.local).axes;
    merged.variants = cloneSnapshot(review.local).variants;
  }
  for (const localVariant of review.local.variants) {
    const mergedVariant = findVariant(merged, localVariant);
    const serverVariant = findVariant(review.server, localVariant);
    if (!mergedVariant || !serverVariant) continue;
    if (choices[`offer-price:${variantKey(localVariant)}`] === "local") {
      mergedVariant.priceToman = localVariant.priceToman;
    }
    if (choices[`offer-sku:${variantKey(localVariant)}`] === "local") {
      mergedVariant.sku = localVariant.sku;
    }
    const key: `inventory:${string}` = `inventory:${variantKey(localVariant)}`;
    mergedVariant.onHand =
      choices[key] === "local" ? localVariant.onHand : serverVariant.onHand;
  }

  return merged;
}

function textSummary(value: string, fallback: string) {
  return value.trim() || fallback;
}

function imageSummary(mediaIds: string[], source: string) {
  return mediaIds.length === 0
    ? "بدون تصویر"
    : `${mediaIds.length.toLocaleString("fa-IR")} تصویر در ${source}`;
}

function structureOf(snapshot: ProductAuthoringSnapshot) {
  return {
    axes: snapshot.axes,
    variants: snapshot.variants.map(({ clientKey, variantId, combination }) => ({
      clientKey,
      variantId,
      combination,
    })),
  };
}

function structureSummary(snapshot: ProductAuthoringSnapshot) {
  const axisCount = snapshot.axes.length;
  const variantCount = snapshot.variants.length;
  if (axisCount === 0) {
    return `کالای ساده با ${variantCount.toLocaleString("fa-IR")} گونه`;
  }
  const axes = snapshot.axes
    .map(
      (axis) =>
        `${axis.name || "محور بدون نام"}: ${axis.values
          .map((value) => value.name || "مقدار بدون نام")
          .join("، ")}`,
    )
    .join("؛ ");
  return `${axes} · ${variantCount.toLocaleString("fa-IR")} گونه`;
}

function priceSummary(value: string) {
  const amount = Number(value);
  const price =
    Number.isSafeInteger(amount) && amount > 0
      ? `${amount.toLocaleString("fa-IR")} تومان`
      : "بدون قیمت";
  return price;
}

function inventorySummary(variant: ProductAuthoringVariant) {
  const count = Number(variant.onHand);
  return Number.isSafeInteger(count) && count >= 0
    ? `${count.toLocaleString("fa-IR")} عدد`
    : "مقدار نامعتبر";
}

function variantLabel(
  snapshot: ProductAuthoringSnapshot,
  variant: ProductAuthoringVariant,
) {
  if (variant.combination.length === 0) return "گونه اصلی";
  const values = variant.combination.flatMap((part) => {
    const axis = snapshot.axes.find(
      (candidate) => candidate.clientKey === part.axisClientKey,
    );
    const value = axis?.values.find(
      (candidate) => candidate.clientKey === part.valueClientKey,
    );
    return value?.name ? [value.name] : [];
  });
  return values.length > 0 ? `گونه ${values.join("، ")}` : "این گونه";
}

function variantKey(variant: ProductAuthoringVariant) {
  return variant.variantId ?? variant.clientKey;
}

function findVariant(
  snapshot: ProductAuthoringSnapshot,
  variant: ProductAuthoringVariant,
) {
  return snapshot.variants.find(
    (candidate) =>
      (variant.variantId && candidate.variantId === variant.variantId) ||
      candidate.clientKey === variant.clientKey,
  );
}

function same(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function cloneSnapshot(snapshot: ProductAuthoringSnapshot): ProductAuthoringSnapshot {
  return {
    ...snapshot,
    orderedMediaIds: [...snapshot.orderedMediaIds],
    axes: snapshot.axes.map((axis) => ({
      ...axis,
      values: axis.values.map((value) => ({ ...value })),
    })),
    variants: snapshot.variants.map((variant) => ({
      ...variant,
      combination: variant.combination.map((part) => ({ ...part })),
    })),
  };
}
