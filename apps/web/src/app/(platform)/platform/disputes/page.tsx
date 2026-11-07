import type { Metadata } from "next";

import {
  PlatformPermissionGate,
  readPlatformWorkspaceRequest,
} from "../_components/platform-access-gate";
import { PlatformDisputes } from "./platform-disputes";

export const metadata: Metadata = {
  title: "رسیدگی به اختلاف‌ها | سوو",
};

export default async function PlatformDisputesPage() {
  const access = await readPlatformWorkspaceRequest("/platform/disputes");
  return (
    <PlatformPermissionGate permission="DISPUTE_REVIEW" returnTo="/platform/disputes">
      <PlatformDisputes
        isSuperadmin={access.kind === "READY" && access.session.isSuperadmin === true}
      />
    </PlatformPermissionGate>
  );
}
