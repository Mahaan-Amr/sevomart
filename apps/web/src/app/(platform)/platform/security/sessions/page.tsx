import {
  readPlatformWorkspaceRequest,
  PlatformAccessStatus,
} from "../../_components/platform-access-gate";
import { PlatformShell } from "../../_components/platform-shell";
import { SessionSecurity } from "../security-forms";

export default async function Page() {
  const access = await readPlatformWorkspaceRequest("/platform/security/sessions");
  if (access.kind === "UNAVAILABLE")
    return (
      <PlatformAccessStatus kind="UNAVAILABLE" returnTo="/platform/security/sessions" />
    );
  if (access.session.permissions.length === 0)
    return (
      <PlatformAccessStatus kind="NO_ACCESS" returnTo="/platform/security/sessions" />
    );
  return (
    <PlatformShell permissions={access.session.permissions}>
      {access.session.permissions.includes("SESSION_SECURITY") ? (
        <SessionSecurity />
      ) : (
        <PlatformAccessStatus kind="FORBIDDEN" returnTo="/platform/security/sessions" />
      )}
    </PlatformShell>
  );
}
