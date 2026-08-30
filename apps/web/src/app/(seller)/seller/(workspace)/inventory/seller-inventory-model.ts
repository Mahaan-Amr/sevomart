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

export function variantLabelsFromSellerProduct(value: unknown) {
  const parsed = sellerProductViewContract.safeParse(value);
  const labels = new Map<string, string>();
  if (!parsed.success || !parsed.data.workingCopy) return labels;
  const workingCopy = parsed.data.workingCopy;
  if (!("variants" in workingCopy)) {
    if (workingCopy.variant?.variantId) labels.set(workingCopy.variant.variantId, "");
    return labels;
  }
  const axes = new Map(
    workingCopy.axes.map((axis) => [
      axis.clientKey,
      {
        name: axis.name,
        values: new Map(axis.values.map((entry) => [entry.clientKey, entry.name])),
      },
    ]),
  );
  for (const variant of workingCopy.variants) {
    const label = variant.combination
      .map((entry) => {
        const axis = axes.get(entry.axisClientKey);
        const valueName = axis?.values.get(entry.valueClientKey);
        return axis && valueName ? `${axis.name}: ${valueName}` : "";
      })
      .filter(Boolean)
      .join("، ");
    labels.set(variant.variantId, label);
  }
  return labels;
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
import { sellerProductViewContract } from "@sevo/contracts/product/v1";
