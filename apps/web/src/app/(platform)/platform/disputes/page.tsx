import type { Metadata } from "next";

import { PlatformPermissionGate } from "../_components/platform-access-gate";
import { PlatformDisputes } from "./platform-disputes";

export const metadata: Metadata = {
  title: "رسیدگی به اختلاف‌ها | سوو",
};

export default function PlatformDisputesPage() {
  return (
    <PlatformPermissionGate permission="DISPUTE_REVIEW" returnTo="/platform/disputes">
      <PlatformDisputes />
    </PlatformPermissionGate>
  );
}
