import {
  publicProductContract,
  sellerProductViewContract,
} from "@sevo/contracts/product/v1";

export function variantLabelsFromPublishedProduct(value: unknown) {
  const parsed = publicProductContract.safeParse(value);
  const labels = new Map<string, string>();
  if (!parsed.success) return labels;
  for (const variant of parsed.data.variants) {
    labels.set(
      variant.variantId,
      variant.combination.map(({ axis, value }) => `${axis}: ${value}`).join("، "),
    );
  }
  return labels;
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
