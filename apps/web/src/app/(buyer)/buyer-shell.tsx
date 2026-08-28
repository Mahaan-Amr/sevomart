"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";

import { loginHref } from "../../lib/navigation";
import styles from "./buyer-shell.module.css";

// Enable each destination only with its complete journey; see buyer-shell-and-navigation.md.
const destinations = [
  { href: "/", label: "کشف", ready: true },
  { href: "/following", label: "دنبال‌شده‌ها", ready: false },
  { href: "/orders", label: "سفارش‌ها", ready: false },
  { href: "/conversations", label: "گفت‌وگوها", ready: false },
];

export function BuyerShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const query = useSearchParams().toString();
  const returnTo = `${pathname}${query ? `?${query}` : ""}`;
  return (
    <div className={styles.shell}>
      <a className={styles.skipLink} href="#buyer-content">
        رفتن به محتوای صفحه
      </a>
      <header className={styles.header}>
        <Link href="/" className={styles.brand} aria-label="سوو؛ کشف تازه‌ها">
          سوو
        </Link>
        <nav className={styles.navigation} aria-label="فضای خریدار">
          {destinations
            .filter((destination) => destination.ready)
            .map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                aria-current={
                  pathname === href || (href !== "/" && pathname.startsWith(`${href}/`))
                    ? "page"
                    : undefined
                }
              >
                {label}
              </Link>
            ))}
        </nav>
        <div className={styles.actions}>
          <Link href="/cart">سبد</Link>
          <details className={styles.identity}>
            <summary>هویت سوو</summary>
            <div className={styles.identityMenu}>
              <Link href="/account/addresses">نشانی‌ها</Link>
              <Link href={loginHref(returnTo, returnTo)}>ورود و ادامه</Link>
            </div>
          </details>
        </div>
      </header>
      <main id="buyer-content" className={styles.content} tabIndex={-1}>
        {children}
      </main>
    </div>
  );
}
