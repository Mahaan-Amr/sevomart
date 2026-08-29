import { createHash } from "node:crypto";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { readIdentitySession } from "../../../../lib/identity-api-proxy";
import { readSellerWorkspaceAccess } from "../../../../lib/seller-workspace-access";
import { SellerAccessStatus } from "../_components/active-seller-gate";
import { SellerApplicationJourney } from "./seller-application-journey";

export default async function SellerApplicationPage() {
  const cookieStore = await cookies();
  const session = await readIdentitySession(cookieStore.toString());
  if (!session) {
    redirect("/seller/login?returnTo=%2Fseller%2Fapplication");
  }
  const access = await readSellerWorkspaceAccess(cookieStore.toString());
  if (access.kind === "ACTIVE") redirect("/seller");
  if (access.kind === "INACTIVE") {
    return <SellerAccessStatus unavailable={false} returnTo="/seller/application" />;
  }
  if (access.kind === "UNAVAILABLE") {
    return <SellerAccessStatus unavailable returnTo="/seller/application" />;
  }
  const draftStorageKey = `sevo:seller-application:${createHash("sha256")
    .update(session.actor.identityId)
    .digest("hex")}`;
  return <SellerApplicationJourney draftStorageKey={draftStorageKey} />;
}
