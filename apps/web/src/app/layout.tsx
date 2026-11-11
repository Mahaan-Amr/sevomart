import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
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
  const seller =
    cookieStore.has("sevo_session") &&
    (await readSellerWorkspaceAccess(cookieStore.toString())).kind === "ACTIVE";
  return (
    <html lang="fa" dir="rtl">
      <body>
        <FeedWorkspace>
          {children}
          <Suspense fallback={null}>
            <BuyerNavigation seller={seller} />
          </Suspense>
        </FeedWorkspace>
        <PwaRegistration />
      </body>
    </html>
  );
}
