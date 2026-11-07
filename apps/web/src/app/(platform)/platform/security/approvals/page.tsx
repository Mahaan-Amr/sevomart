import {
  readPlatformWorkspaceRequest,
  PlatformAccessStatus,
} from "../../_components/platform-access-gate";
import { PlatformShell } from "../../_components/platform-shell";
import { RecoveryApproval } from "../security-forms";

export default async function Page() {
  const access = await readPlatformWorkspaceRequest("/platform/security/approvals");
  if (access.kind === "UNAVAILABLE")
    return (
      <PlatformAccessStatus
        kind="UNAVAILABLE"
        returnTo="/platform/security/approvals"
      />
    );
  if (access.session.permissions.length === 0)
    return (
      <PlatformAccessStatus kind="NO_ACCESS" returnTo="/platform/security/approvals" />
    );
  return (
    <PlatformShell permissions={access.session.permissions}>
      {access.session.permissions.includes("ACCESS_ADMINISTRATION") ? (
        <RecoveryApproval />
      ) : (
        <PlatformAccessStatus
          kind="FORBIDDEN"
          returnTo="/platform/security/approvals"
        />
      )}
    </PlatformShell>
  );
}
