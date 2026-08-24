import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { readIdentitySession } from "../../lib/identity-api-proxy";
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
  const returnTo = safePath(first(parameters.returnTo), "/");
  const cancelTo = safePath(first(parameters.cancelTo), returnTo.split("?")[0] ?? "/");
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

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function safePath(value: string | undefined, fallback: string) {
  if (!value?.startsWith("/") || value.startsWith("//")) return fallback;
  try {
    const base = "https://sevo.local";
    const target = new URL(value, base);
    return target.origin === base
      ? `${target.pathname}${target.search}${target.hash}`
      : fallback;
  } catch {
    return fallback;
  }
}
