import type { Metadata } from "next";

import { PlatformPaymentReviews } from "./platform-payment-reviews";

export const metadata: Metadata = {
  title: "بررسی پرداخت‌ها | سوو",
};

export default function PlatformPaymentReviewsPage() {
  return <PlatformPaymentReviews />;
}
