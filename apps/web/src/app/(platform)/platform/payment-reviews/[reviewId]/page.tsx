import type { Metadata } from "next";

import {
  PlatformPermissionGate,
  readPlatformWorkspaceRequest,
} from "../../_components/platform-access-gate";
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
  const access = await readPlatformWorkspaceRequest(
    `/platform/payment-reviews/${reviewId}`,
  );
  return (
    <PlatformPermissionGate
      permission="PAYMENT_REVIEW"
      returnTo={`/platform/payment-reviews/${reviewId}`}
    >
      <PaymentReviewDetail
        reviewId={reviewId}
        isSuperadmin={access.kind === "READY" && access.session.isSuperadmin === true}
      />
    </PlatformPermissionGate>
  );
}
