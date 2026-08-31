import type { Metadata } from "next";

import { PlatformPermissionGate } from "../../_components/platform-access-gate";
import { PaymentReviewDetail } from "./payment-review-detail";

export const metadata: Metadata = {
  title: "جزئیات بررسی پرداخت | سوو",
};

export default async function PaymentReviewDetailPage({
  params,
}: {
  params: Promise<{ reviewId: string }>;
}) {
  const { reviewId } = await params;
  return (
    <PlatformPermissionGate
      permission="PAYMENT_REVIEW"
      returnTo={`/platform/payment-reviews/${reviewId}`}
    >
      <PaymentReviewDetail reviewId={reviewId} />
    </PlatformPermissionGate>
  );
}
