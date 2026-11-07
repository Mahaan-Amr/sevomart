import {
  PlatformAccessStatus,
  readPlatformWorkspaceRequest,
} from "../../_components/platform-access-gate";
import { PlatformShell } from "../../_components/platform-shell";
import { RecoveryRequest } from "./recovery-request";
export default async function Page() {
  const access = await readPlatformWorkspaceRequest("/platform/access/recovery");
  if (access.kind === "UNAVAILABLE")
    return (
      <PlatformAccessStatus kind="UNAVAILABLE" returnTo="/platform/access/recovery" />
    );
  if (!access.session.isSuperadmin)
    return <PlatformAccessStatus kind="FORBIDDEN" returnTo="/platform/access" />;
  return (
    <PlatformShell permissions={access.session.permissions}>
      <RecoveryRequest />
    </PlatformShell>
  );
}
