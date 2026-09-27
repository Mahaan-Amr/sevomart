import type { Metadata, Viewport } from "next";
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

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="fa" dir="rtl">
      <body>
        <FeedWorkspace>
          {children}
          <Suspense fallback={null}>
            <BuyerNavigation />
          </Suspense>
        </FeedWorkspace>
        <PwaRegistration />
      </body>
    </html>
  );
}
