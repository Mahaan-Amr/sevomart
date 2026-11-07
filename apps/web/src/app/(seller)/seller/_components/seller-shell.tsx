"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import styles from "./seller-shell.module.css";

const icons: Record<string, string> = {
  "/seller": "M3 10 12 3l9 7v10h-6v-6H9v6H3z",
  "/seller/orders": "M5 4h14v16H5z M8 8h8 M8 12h8 M8 16h5",
  "/seller/products": "M4 7 12 3l8 4v10l-8 4-8-4z M4 7l8 4 8-4 M12 11v10",
  "/seller/content": "M4 4h16v16H4z M7 8h10 M7 12h10 M7 16h6",
  "/seller/inventory": "M3 7h18v13H3z M6 4h12l3 3 M9 11h6",
  "/seller/store": "M4 10v10h16V10 M3 10l2-6h14l2 6 M8 20v-6h8v6",
};

const destinations = [
  { href: "/seller", label: "خانه" },
  { href: "/seller/orders", label: "سفارش‌ها" },
  {
    href: "/seller/disputes",
    label: "پرونده‌های اختلاف",
    desktopOnly: true,
  },
  { href: "/seller/products", label: "کالاها" },
  { href: "/seller/content", label: "محتوا" },
  { href: "/seller/inventory", label: "موجودی" },
  { href: "/seller/store", label: "فروشگاه" },
] as const;

export function SellerShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <Link className={styles.brand} href="/seller" aria-label="خانه فضای کار سوو">
          سوو
        </Link>
        <nav className={styles.navigation} aria-label="ناوبری فضای کار فروشنده">
          <SellerNavigationLinks pathname={pathname} mobile={false} />
        </nav>
        <Link className={styles.buyerLink} href="/">
          فضای خریدار
        </Link>
      </aside>
      <div className={styles.content}>{children}</div>
      <nav className={styles.mobileNavigation} aria-label="ناوبری فضای کار فروشنده">
        <SellerNavigationLinks pathname={pathname} mobile />
      </nav>
    </div>
  );
}

function SellerNavigationLinks({
  pathname,
  mobile,
}: {
  pathname: string;
  mobile: boolean;
}) {
  return destinations
    .filter((destination) => !mobile || !("desktopOnly" in destination))
    .map((destination) => {
      const active =
        destination.href === "/seller"
          ? pathname === destination.href
          : pathname.startsWith(destination.href);
      return (
        <Link
          key={destination.href}
          href={destination.href}
          className={
            mobile
              ? active
                ? styles.activeMobileLink
                : styles.mobileLink
              : active
                ? styles.activeLink
                : styles.link
          }
          aria-current={active ? "page" : undefined}
        >
          {mobile && (
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={styles.mobileIcon}
            >
              <path d={icons[destination.href]} />
            </svg>
          )}
          <span>{destination.label}</span>
        </Link>
      );
    });
}
