import type { Metadata } from "next";

import { PlatformPermissionGate } from "../_components/platform-access-gate";
import { PlatformViolationReview } from "./platform-violation-review";

export const metadata: Metadata = {
  title: "بررسی پرونده‌های تخلف | سوو",
};

export default function PlatformViolationsPage() {
  return (
    <PlatformPermissionGate
      permission="VIOLATION_REVIEW"
      returnTo="/platform/violations"
    >
      <PlatformViolationReview />
    </PlatformPermissionGate>
  );
}
