import { createHash } from "node:crypto";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { readIdentitySession } from "../../../../lib/identity-api-proxy";
import { SellerApplicationJourney } from "./seller-application-journey";

export default async function SellerApplicationPage() {
  const cookieStore = await cookies();
  const session = await readIdentitySession(cookieStore.toString());
  if (!session) {
    redirect("/seller/login?returnTo=%2Fseller%2Fapplication");
  }
  const draftStorageKey = `sevo:seller-application:${createHash("sha256")
    .update(session.actor.identityId)
    .digest("hex")}`;
  return <SellerApplicationJourney draftStorageKey={draftStorageKey} />;
}
