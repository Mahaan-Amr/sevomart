export type InventoryAdjustmentAction = "INCREASE" | "DECREASE" | "CORRECT";

const persianDigits = "۰۱۲۳۴۵۶۷۸۹";
const arabicDigits = "٠١٢٣٤٥٦٧٨٩";

export function parseInventoryQuantity(rawValue: string): number | undefined {
  const normalized = [...rawValue.trim()]
    .map((character) => {
      const persianIndex = persianDigits.indexOf(character);
      if (persianIndex >= 0) return String(persianIndex);
      const arabicIndex = arabicDigits.indexOf(character);
      if (arabicIndex >= 0) return String(arabicIndex);
      return character;
    })
    .join("")
    .replace(/[٬,]/g, "");
  if (!/^\d+$/.test(normalized)) return undefined;
  const value = Number(normalized);
  return Number.isSafeInteger(value) ? value : undefined;
}

export function calculateInventoryTarget(
  action: InventoryAdjustmentAction,
  currentOnHand: number,
  rawValue: string,
): { value: number } | { error: string } {
  const quantity = parseInventoryQuantity(rawValue);
  if (quantity === undefined) {
    return { error: "یک عدد صحیح و نامنفی وارد کنید." };
  }
  if (action !== "CORRECT" && quantity === 0) {
    return { error: "مقدار افزایش یا کاهش باید بیشتر از صفر باشد." };
  }
  const value =
    action === "INCREASE"
      ? currentOnHand + quantity
      : action === "DECREASE"
        ? currentOnHand - quantity
        : quantity;
  if (!Number.isSafeInteger(value)) {
    return { error: "مقدار واردشده بیش از حد مجاز است." };
  }
  if (value < 0) {
    return {
      error: "موجودی نمی‌تواند کمتر از صفر شود. مقدار کاهش را کمتر کنید.",
    };
  }
  return { value };
}

export function matchesInventorySearch(
  item: { productName: string; variantLabel: string },
  query: string,
) {
  const haystack = normalizeSearchText(`${item.productName} ${item.variantLabel}`);
  return normalizeSearchText(query)
    .split(" ")
    .filter(Boolean)
    .every((token) => haystack.includes(token));
}

export type PendingInventoryWrite = Readonly<{
  payload: string;
  idempotencyKey: string;
}>;

export function prepareInventoryWrite(
  pending: PendingInventoryWrite | undefined,
  payload: string,
  createIdempotencyKey: () => string,
): PendingInventoryWrite {
  return pending?.payload === payload
    ? pending
    : { payload, idempotencyKey: createIdempotencyKey() };
}

export type InventoryErrorCode =
  | "INVENTORY_NOT_FOUND"
  | "REVISION_CONFLICT"
  | "IDEMPOTENCY_CONFLICT"
  | "RESERVED_STOCK_CONFLICT"
  | "SELLER_ACCESS_INACTIVE"
  | "VALIDATION_ERROR"
  | "PRECONDITION_REQUIRED"
  | "UNAUTHORIZED";

export type InventoryRecovery = "REFRESH" | "LOGIN" | "SELLER_HOME";

export function inventoryErrorGuidance(code: InventoryErrorCode): {
  message: string;
  recovery?: InventoryRecovery;
} {
  switch (code) {
    case "REVISION_CONFLICT":
      return {
        message:
          "موجودی پس از بازشدن این صفحه تغییر کرده است. اطلاعات تازه را بگیرید و دوباره ثبت کنید.",
        recovery: "REFRESH",
      };
    case "RESERVED_STOCK_CONFLICT":
      return {
        message:
          "بخشی از موجودی برای سفارش فعال کنار گذاشته شده است. اطلاعات تازه را بگیرید و عددی کمتر از مقدار رزروشده ثبت نکنید.",
        recovery: "REFRESH",
      };
    case "INVENTORY_NOT_FOUND":
      return {
        message: "این گونه دیگر قابل مدیریت نیست. فهرست را تازه کنید.",
        recovery: "REFRESH",
      };
    case "IDEMPOTENCY_CONFLICT":
      return {
        message:
          "این درخواست با اطلاعات دیگری ثبت شده است. اطلاعات تازه را بگیرید و تغییر را دوباره وارد کنید.",
        recovery: "REFRESH",
      };
    case "SELLER_ACCESS_INACTIVE":
      return {
        message:
          "دسترسی فروشندگی شما فعال نیست. برای دیدن وضعیت و مسیر پیگیری به خانه فروشنده برگردید.",
        recovery: "SELLER_HOME",
      };
    case "VALIDATION_ERROR":
      return {
        message: "عدد قابل ثبت نیست؛ موجودی باید یک عدد صحیح و نامنفی باشد.",
      };
    case "PRECONDITION_REQUIRED":
      return {
        message:
          "پیش‌نیاز ثبت تغییر کامل نشد. اطلاعات تازه را بگیرید و دوباره تلاش کنید.",
        recovery: "REFRESH",
      };
    case "UNAUTHORIZED":
      return {
        message:
          "نشست شما پایان یافته است. دوباره وارد شوید و تغییر را از نو بررسی کنید.",
        recovery: "LOGIN",
      };
  }
}

function normalizeSearchText(value: string) {
  return value
    .normalize("NFKC")
    .replace(/[يى]/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/[‌\s]+/g, " ")
    .trim()
    .toLocaleLowerCase("fa-IR");
}
