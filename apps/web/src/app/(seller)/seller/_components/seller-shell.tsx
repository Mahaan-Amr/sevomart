"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import styles from "./seller-shell.module.css";

const destinations = [
  { href: "/seller", label: "خانه", icon: "⌂" },
  { href: "/seller/orders", label: "سفارش‌ها", icon: "□" },
  { href: "/seller/products", label: "کالاها", icon: "◇" },
  { href: "/seller/inventory", label: "موجودی", icon: "≡" },
  { href: "/seller/store", label: "فروشگاه", icon: "○" },
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
  return destinations.map((destination) => {
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
        <span aria-hidden="true">{destination.icon}</span>
        <span>{destination.label}</span>
      </Link>
    );
  });
}
