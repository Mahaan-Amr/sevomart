import { ActiveSellerGate } from "../../../_components/active-seller-gate";
import { StoreBuilder } from "../../../store/store-builder";

export default function StoreProfilePage() {
  return (
    <ActiveSellerGate returnTo="/seller/store/profile">
      <StoreBuilder section="profile" />
    </ActiveSellerGate>
  );
}
