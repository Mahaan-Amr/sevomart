import {
  readPlatformWorkspaceRequest,
  PlatformAccessStatus,
} from "../../_components/platform-access-gate";
import { PlatformShell } from "../../_components/platform-shell";
import { Authenticator } from "../security-forms";

export default async function Page() {
  const access = await readPlatformWorkspaceRequest("/platform/security/authenticator");
  if (access.kind === "UNAVAILABLE")
    return (
      <PlatformAccessStatus
        kind="UNAVAILABLE"
        returnTo="/platform/security/authenticator"
      />
    );
  if (access.session.permissions.length === 0)
    return (
      <PlatformAccessStatus
        kind="NO_ACCESS"
        returnTo="/platform/security/authenticator"
      />
    );
  const canAdmin = access.session.permissions.includes("ACCESS_ADMINISTRATION");
  return (
    <PlatformShell permissions={access.session.permissions}>
      <Authenticator canAdmin={canAdmin} />
    </PlatformShell>
  );
}
