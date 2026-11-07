import {
  PlatformAccessStatus,
  readPlatformWorkspaceRequest,
} from "../_components/platform-access-gate";
import { PlatformShell } from "../_components/platform-shell";
import { Superadmins } from "./superadmins";

export default async function SuperadminsPage() {
  const access = await readPlatformWorkspaceRequest("/platform/superadmins");
  if (access.kind === "UNAVAILABLE")
    return <PlatformAccessStatus kind="UNAVAILABLE" returnTo="/platform/superadmins" />;
  return (
    <PlatformShell permissions={access.session.permissions}>
      {access.session.isSuperadmin ? (
        <Superadmins />
      ) : (
        <PlatformAccessStatus kind="FORBIDDEN" returnTo="/platform/superadmins" />
      )}
    </PlatformShell>
  );
}
