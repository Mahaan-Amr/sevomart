import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import "./globals.css";
import { PwaRegistration } from "./pwa-registration";

export const metadata: Metadata = {
  title: "سوو",
  description: "فروشگاه‌ها و کالاهای تازه در سوو",
  manifest: "/manifest.webmanifest",
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
        {children}
        <PwaRegistration />
      </body>
    </html>
  );
}
