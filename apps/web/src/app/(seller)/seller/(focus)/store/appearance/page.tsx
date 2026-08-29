import { ActiveSellerGate } from "../../../_components/active-seller-gate";
import { StoreBuilder } from "../../../store/store-builder";

export default function StoreAppearancePage() {
  return (
    <ActiveSellerGate returnTo="/seller/store/appearance">
      <StoreBuilder section="appearance" />
    </ActiveSellerGate>
  );
}
