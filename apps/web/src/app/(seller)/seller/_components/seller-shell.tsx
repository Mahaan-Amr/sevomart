"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import styles from "./seller-shell.module.css";

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
          <span>{destination.label}</span>
        </Link>
      );
    });
}
