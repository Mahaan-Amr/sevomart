import { Suspense, type ReactNode } from "react";
import { cookies } from "next/headers";

import { readIdentitySession } from "../../../lib/identity-api-proxy";
import { BuyerShell } from "../buyer-shell";

export default async function BrowseLayout({ children }: { children: ReactNode }) {
  const session = await readIdentitySession((await cookies()).toString());
  return (
    <Suspense
      fallback={
        <main>
          <p role="status">در حال آماده‌کردن صفحه…</p>
        </main>
      }
    >
      <BuyerShell session={session}>{children}</BuyerShell>
    </Suspense>
  );
}
