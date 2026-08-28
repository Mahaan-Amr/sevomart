import { Suspense, type ReactNode } from "react";

import { BuyerShell } from "../buyer-shell";

export default function BrowseLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense
      fallback={
        <main>
          <p role="status">در حال آماده‌کردن صفحه…</p>
        </main>
      }
    >
      <BuyerShell>{children}</BuyerShell>
    </Suspense>
  );
}
