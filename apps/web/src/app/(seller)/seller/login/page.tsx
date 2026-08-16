import { cookies } from "next/headers";

import { readSellerSession } from "../../../../lib/identity-api-proxy";
import { SellerLogin } from "./seller-login";

export default async function SellerLoginPage() {
  const cookieStore = await cookies();
  const session = await readSellerSession(cookieStore.toString());

  return (
    <SellerLogin
      initiallySignedIn={Boolean(session)}
      showDevelopmentCode={
        (process.env.SEVO_RUNTIME_ENV ?? process.env.NODE_ENV) !== "production" &&
        (process.env.OTP_PROVIDER ?? "dev") === "dev"
      }
    />
  );
}
