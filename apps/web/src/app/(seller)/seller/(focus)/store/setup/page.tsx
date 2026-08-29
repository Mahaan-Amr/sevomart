import { ActiveSellerGate } from "../../../_components/active-seller-gate";
import { StoreBuilder } from "../../../store/store-builder";

export default function StoreSetupPage() {
  return (
    <ActiveSellerGate returnTo="/seller/store/setup">
      <StoreBuilder />
    </ActiveSellerGate>
  );
}
