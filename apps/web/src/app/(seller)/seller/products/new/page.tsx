import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { readIdentitySession } from "../../../../../lib/identity-api-proxy";
import { SimpleProductBuilder } from "./simple-product-builder";

export default async function NewProductPage() {
  const cookieStore = await cookies();
  const session = await readIdentitySession(cookieStore.toString());
  if (!session) {
    redirect("/seller/login?returnTo=%2Fseller%2Fproducts%2Fnew");
  }
  return <SimpleProductBuilder />;
}
