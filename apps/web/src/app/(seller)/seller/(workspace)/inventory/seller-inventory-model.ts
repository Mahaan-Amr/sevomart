import type { ProductView, SimpleProductView } from "@sevo/contracts/product/v1";

export type InventoryRow = {
  variantId: string;
  label: string;
  onHand: number;
  revision: number;
};

export type InventoryProduct = {
  productId: string;
  name: string;
  product: ProductView | SimpleProductView;
  rows: InventoryRow[];
};

export function buildInventoryWrite(product: InventoryProduct) {
  const current = product.product;
  if (Array.isArray(current.inventory)) {
    return {
      endpoint: "inventory" as const,
      body: {
        expectedRevision: current.revision,
        reasonCode: "MANUAL_COUNT" as const,
        rows: product.rows.map(({ variantId, onHand, revision }) => ({
          variantId,
          onHand,
          expectedRevision: revision,
        })),
      },
    };
  }
  const simple = current as SimpleProductView;
  if (!simple.workingCopy) throw new Error("simple product is unavailable");
  const row = product.rows[0];
  return {
    endpoint: "working-copy" as const,
    body: {
      expectedRevision: simple.revision,
      workingCopy: {
        name: simple.workingCopy.name,
        description: simple.workingCopy.description,
        orderedMediaIds: simple.workingCopy.orderedMediaIds,
        variant: {
          clientKey: simple.workingCopy.variant.variantId,
          price: simple.workingCopy.variant.price,
        },
      },
      inventory: row
        ? {
            onHand: row.onHand,
            expectedRevision: simple.inventory?.revision ?? 0,
          }
        : null,
    },
  };
}

export function toInventoryProduct(
  name: string,
  product: ProductView | SimpleProductView,
): InventoryProduct {
  if (Array.isArray(product.inventory)) {
    const multivariant = product as ProductView;
    const variants = multivariant.workingCopy?.variants ?? [];
    const axes = new Map(
      (multivariant.workingCopy?.axes ?? []).map((axis) => [
        axis.clientKey,
        {
          name: axis.name,
          values: new Map(axis.values.map((value) => [value.clientKey, value.name])),
        },
      ]),
    );
    return {
      productId: multivariant.productId,
      name,
      product: multivariant,
      rows: multivariant.inventory.map((inventory, index) => ({
        ...inventory,
        label: variantLabel(
          variants.find((variant) => variant.variantId === inventory.variantId),
          axes,
          index,
        ),
      })),
    };
  }
  const simple = product as SimpleProductView;
  return {
    productId: simple.productId,
    name,
    product: simple,
    rows:
      simple.inventory && simple.workingCopy
        ? [
            {
              variantId: simple.workingCopy.variant.variantId,
              label: "گونه اصلی",
              onHand: simple.inventory.onHand,
              revision: simple.inventory.revision,
            },
          ]
        : [],
  };
}

function variantLabel(
  variant: NonNullable<ProductView["workingCopy"]>["variants"][number] | undefined,
  axes: Map<string, { name: string; values: Map<string, string> }>,
  index: number,
) {
  if (!variant) return `گونه ${index + 1}`;
  const attributes = variant.combination.map(({ axisClientKey, valueClientKey }) => {
    const axis = axes.get(axisClientKey);
    return axis
      ? `${axis.name}: ${axis.values.get(valueClientKey) ?? valueClientKey}`
      : valueClientKey;
  });
  return attributes.length > 0
    ? attributes.join("، ")
    : (variant.sku ?? `گونه ${index + 1}`);
}
