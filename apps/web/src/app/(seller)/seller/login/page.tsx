import { cookies } from "next/headers";

import { readIdentitySession } from "../../../../lib/identity-api-proxy";
import { IdentityLogin } from "../../../login/identity-login";

export default async function SellerLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string | string[] }>;
}) {
  const cookieStore = await cookies();
  const session = await readIdentitySession(cookieStore.toString());
  const requestedReturnTo = (await searchParams).returnTo;
  const returnTo = safeReturnTo(
    Array.isArray(requestedReturnTo) ? requestedReturnTo[0] : requestedReturnTo,
  );

  return (
    <IdentityLogin
      initiallySignedIn={Boolean(session)}
      returnTo={returnTo}
      showDevelopmentCode={
        (process.env.SEVO_RUNTIME_ENV ?? process.env.NODE_ENV) !== "production" &&
        (process.env.OTP_PROVIDER ?? "dev") === "dev"
      }
    />
  );
}

function safeReturnTo(value: string | undefined): string {
  if (!value?.startsWith("/") || value.startsWith("//")) return "/seller";
  try {
    const base = "https://sevo.local";
    const target = new URL(value, base);
    return target.origin === base
      ? `${target.pathname}${target.search}${target.hash}`
      : "/seller";
  } catch {
    return "/seller";
  }
}
