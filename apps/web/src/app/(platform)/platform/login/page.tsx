import { PlatformAgentLogin } from "./platform-agent-login";
import { firstParameter, safeReturnPath } from "../../../../lib/navigation";

export default async function PlatformAgentLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string | string[] }>;
}) {
  const returnTo = safeReturnPath(
    firstParameter((await searchParams).returnTo),
    "/platform",
  );
  return <PlatformAgentLogin returnTo={returnTo} />;
}
