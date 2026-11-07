import type { Metadata } from "next";
import Link from "next/link";

import {
  PlatformAccessStatus,
  readPlatformWorkspaceRequest,
} from "../_components/platform-access-gate";
import { PlatformShell } from "../_components/platform-shell";
import { PlatformAccessWorkspace } from "./platform-access-workspace";

export const metadata: Metadata = {
  title: "مدیریت دسترسی پلتفرم | سوو",
};

export default async function PlatformAccessPage() {
  const access = await readPlatformWorkspaceRequest("/platform/access");
  if (access.kind === "UNAVAILABLE") {
    return <PlatformAccessStatus kind="UNAVAILABLE" returnTo="/platform/access" />;
  }
  const canAdminister = access.session.permissions.includes("ACCESS_ADMINISTRATION");
  const canReviewAudit = access.session.permissions.includes("ACCESS_AUDIT_REVIEW");
  if (!canAdminister && !canReviewAudit) {
    return (
      <PlatformShell permissions={access.session.permissions}>
        <PlatformAccessStatus kind="FORBIDDEN" returnTo="/platform/access" />
      </PlatformShell>
    );
  }
  return (
    <PlatformShell permissions={access.session.permissions}>
      {access.session.isSuperadmin && (
        <p>
          <Link href="/platform/superadmins">مدیریت سوپرادمین‌ها</Link>
          {" · "}
          <Link href="/platform/access/recovery">بازیابی دسترسی همکار</Link>
        </p>
      )}
      <PlatformAccessWorkspace
        actorIdentityId={access.session.actor.identityId}
        canAdminister={canAdminister}
        canReviewAudit={canReviewAudit}
      />
    </PlatformShell>
  );
}
