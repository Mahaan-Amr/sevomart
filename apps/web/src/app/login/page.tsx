import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { readIdentitySession } from "../../lib/identity-api-proxy";
import { firstParameter, safeReturnPath } from "../../lib/navigation";
import { IdentityLogin } from "./identity-login";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{
    returnTo?: string | string[];
    cancelTo?: string | string[];
  }>;
}) {
  const parameters = await searchParams;
  const returnTo = safeReturnPath(firstParameter(parameters.returnTo), "/");
  const cancelTo = safeReturnPath(firstParameter(parameters.cancelTo), "/");
  const session = await readIdentitySession((await cookies()).toString());
  if (session) redirect(returnTo);

  return (
    <IdentityLogin
      initiallySignedIn={false}
      returnTo={returnTo}
      cancelTo={cancelTo}
      autoContinue
      showDevelopmentCode={
        (process.env.SEVO_RUNTIME_ENV ?? process.env.NODE_ENV) !== "production" &&
        (process.env.OTP_PROVIDER ?? "dev") === "dev"
      }
    />
  );
}
