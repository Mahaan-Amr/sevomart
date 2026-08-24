import type { Metadata } from "next";

import { PlatformSellerApplicationReview } from "./platform-seller-application-review";

export const metadata: Metadata = {
  title: "بررسی درخواست‌های فروشندگی | سوو",
};

export default function PlatformSellerApplicationsPage() {
  return <PlatformSellerApplicationReview />;
}
