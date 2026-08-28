import { ActiveSellerGate } from "../../../_components/active-seller-gate";
import { SimpleProductBuilder } from "../../../products/new/simple-product-builder";

export default function NewProductPage() {
  return (
    <ActiveSellerGate returnTo="/seller/products/new">
      <SimpleProductBuilder />
    </ActiveSellerGate>
  );
}
