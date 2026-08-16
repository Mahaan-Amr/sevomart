import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { readSellerSession } from "../../../../lib/identity-api-proxy";
import { StoreBuilder } from "./store-builder";

export default async function StoreBuilderPage() {
  const cookieStore = await cookies();
  const session = await readSellerSession(cookieStore.toString());
  if (!session) redirect("/seller/login");
  return <StoreBuilder />;
}
