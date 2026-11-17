import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { readIdentitySession } from "../lib/identity-api-proxy";
import { readSellerWorkspaceAccess } from "../lib/seller-workspace-access";
import { Suspense, type ReactNode } from "react";

import "./globals.css";
import { PwaRegistration } from "./pwa-registration";
import { FeedWorkspace } from "./(buyer)/(browse)/feed-workspace";
import { BuyerNavigation } from "./(buyer)/buyer-navigation";

export const metadata: Metadata = {
  title: "سوو",
  description: "فروشگاه‌ها و کالاهای تازه در سوو",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = {
  themeColor: "#A41439",
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  const cookieStore = await cookies();
  const cookieHeader = cookieStore.toString();
  const [session, access] = cookieStore.has("sevo_session")
    ? await Promise.all([
        readIdentitySession(cookieHeader),
        readSellerWorkspaceAccess(cookieHeader),
      ])
    : [undefined, undefined];
  const seller = access?.kind === "ACTIVE";
  return (
    <html lang="fa" dir="rtl">
      <body>
        <FeedWorkspace>
          {children}
          <Suspense fallback={null}>
            <BuyerNavigation seller={seller} signedIn={!!session} />
          </Suspense>
        </FeedWorkspace>
        <PwaRegistration />
      </body>
    </html>
  );
}
