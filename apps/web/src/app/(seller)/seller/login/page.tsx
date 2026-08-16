import { cookies } from "next/headers";

import { SellerLogin } from "./seller-login";

export default async function SellerLoginPage() {
  const cookieStore = await cookies();

  return (
    <SellerLogin
      initiallySignedIn={cookieStore.has("sevo_seller_session")}
      showDevelopmentCode={process.env.NODE_ENV !== "production"}
    />
  );
}
