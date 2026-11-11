import { Suspense, type ReactNode } from "react";
import { cookies } from "next/headers";

import { readSellerWorkspaceAccess } from "../../../lib/seller-workspace-access";
import { readIdentitySession } from "../../../lib/identity-api-proxy";
import { BuyerShell } from "../buyer-shell";

export default async function BrowseLayout({ children }: { children: ReactNode }) {
  const cookieHeader = (await cookies()).toString();
  const session = await readIdentitySession(cookieHeader);
  const seller =
    !!session && (await readSellerWorkspaceAccess(cookieHeader)).kind === "ACTIVE";
  return (
    <Suspense
      fallback={
        <main>
          <p role="status">در حال آماده‌کردن صفحه…</p>
        </main>
      }
    >
      <BuyerShell session={session} seller={seller}>
        {children}
      </BuyerShell>
    </Suspense>
  );
}
