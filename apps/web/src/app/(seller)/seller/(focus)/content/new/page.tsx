import { ActiveSellerGate } from "../../../_components/active-seller-gate";
import { SellerSalesContentWorkspace } from "../../../content/seller-sales-content-workspace";

export default function NewSellerSalesContentPage() {
  return (
    <ActiveSellerGate returnTo="/seller/content/new">
      <SellerSalesContentWorkspace mode="create" />
    </ActiveSellerGate>
  );
}
