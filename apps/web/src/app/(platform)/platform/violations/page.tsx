import type { Metadata } from "next";

import {
  PlatformPermissionGate,
  readPlatformWorkspaceRequest,
} from "../_components/platform-access-gate";
import { PlatformViolationReview } from "./platform-violation-review";

export const metadata: Metadata = {
  title: "بررسی پرونده‌های تخلف | سوو",
};

export default async function PlatformViolationsPage() {
  const access = await readPlatformWorkspaceRequest("/platform/violations");
  return (
    <PlatformPermissionGate
      permission="VIOLATION_REVIEW"
      returnTo="/platform/violations"
    >
      <PlatformViolationReview
        isSuperadmin={access.kind === "READY" && access.session.isSuperadmin === true}
      />
    </PlatformPermissionGate>
  );
}
