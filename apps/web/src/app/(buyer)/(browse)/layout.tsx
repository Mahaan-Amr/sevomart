import { Suspense, type ReactNode } from "react";

import { BuyerShell } from "../buyer-shell";
import { FeedWorkspace } from "./feed-workspace";

export default function BrowseLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense
      fallback={
        <main>
          <p role="status">در حال آماده‌کردن صفحه…</p>
        </main>
      }
    >
      <FeedWorkspace>
        <BuyerShell>{children}</BuyerShell>
      </FeedWorkspace>
    </Suspense>
  );
}
