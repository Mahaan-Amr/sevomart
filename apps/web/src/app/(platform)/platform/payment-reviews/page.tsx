import type { Metadata } from "next";

import { PlatformPaymentReviews } from "./platform-payment-reviews";
import { PlatformPermissionGate } from "../_components/platform-access-gate";

export const metadata: Metadata = {
  title: "بررسی پرداخت‌ها | سوو",
};

export default function PlatformPaymentReviewsPage() {
  return (
    <PlatformPermissionGate
      permission="PAYMENT_REVIEW"
      returnTo="/platform/payment-reviews"
    >
      <PlatformPaymentReviews />
    </PlatformPermissionGate>
  );
}
