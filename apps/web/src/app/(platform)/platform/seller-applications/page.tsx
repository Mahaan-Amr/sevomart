import type { Metadata } from "next";

import { PlatformSellerApplicationReview } from "./platform-seller-application-review";
import { PlatformPermissionGate } from "../_components/platform-access-gate";

export const metadata: Metadata = {
  title: "بررسی درخواست‌های فروشندگی | سوو",
};

export default function PlatformSellerApplicationsPage() {
  return (
    <PlatformPermissionGate
      permission="SELLER_APPLICATION_REVIEW"
      returnTo="/platform/seller-applications"
    >
      <PlatformSellerApplicationReview />
    </PlatformPermissionGate>
  );
}
