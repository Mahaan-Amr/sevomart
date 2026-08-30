import { ActiveSellerGate } from "../../../../_components/active-seller-gate";
import { SimpleProductBuilder } from "../../../../products/new/simple-product-builder";

export default async function EditProductPage({
  params,
}: {
  params: Promise<{ productId: string }>;
}) {
  const { productId } = await params;
  const returnTo = `/seller/products/${productId}/edit`;
  return (
    <ActiveSellerGate returnTo={returnTo}>
      <SimpleProductBuilder productId={productId} />
    </ActiveSellerGate>
  );
}
