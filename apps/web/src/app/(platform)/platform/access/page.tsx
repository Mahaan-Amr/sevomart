import type { Metadata } from "next";

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
      <PlatformAccessWorkspace
        actorIdentityId={access.session.actor.identityId}
        canAdminister={canAdminister}
        canReviewAudit={canReviewAudit}
      />
    </PlatformShell>
  );
}
