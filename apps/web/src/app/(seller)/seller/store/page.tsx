import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { readIdentitySession } from "../../../../lib/identity-api-proxy";
import { StoreBuilder } from "./store-builder";

export default async function StoreBuilderPage() {
  const cookieStore = await cookies();
  const session = await readIdentitySession(cookieStore.toString());
  if (!session) redirect("/seller/login?returnTo=%2Fseller%2Fstore");
  return <StoreBuilder />;
}
