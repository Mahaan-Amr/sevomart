"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, type ReactNode } from "react";

import { loginHref } from "../../lib/navigation";
import { useFeedWorkspace } from "./(browse)/feed-workspace";
import styles from "./buyer-shell.module.css";

// Enable each destination only with its complete journey; see buyer-shell-and-navigation.md.
const destinations = [
  { href: "/", label: "کشف", ready: true },
  { href: "/following", label: "دنبال‌شده‌ها", ready: true },
  { href: "/orders", label: "سفارش‌ها", ready: true },
  { href: "/conversations", label: "گفت‌وگوها", ready: true },
];

export function BuyerShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const query = useSearchParams().toString();
  const { rememberScroll, restored, scrollFor } = useFeedWorkspace();
  const returnTo = `${pathname}${query ? `?${query}` : ""}`;
  const activeFeed =
    pathname === "/" ? "discovery" : pathname === "/following" ? "following" : null;

  useEffect(() => {
    if (!activeFeed || !restored) return;
    const target = scrollFor(activeFeed);
    let frame = 0;
    let attempts = 0;
    const restore = () => {
      window.scrollTo(0, target);
      attempts += 1;
      if (Math.abs(window.scrollY - target) > 1 && attempts < 120) {
        frame = requestAnimationFrame(restore);
      }
    };
    frame = requestAnimationFrame(restore);
    return () => cancelAnimationFrame(frame);
  }, [activeFeed, restored, scrollFor]);

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
                scroll={href !== "/" && href !== "/following"}
                onClick={() => {
                  const feedKind =
                    pathname === "/"
                      ? "discovery"
                      : pathname === "/following"
                        ? "following"
                        : undefined;
                  if (feedKind) {
                    rememberScroll(feedKind, window.scrollY);
                  }
                }}
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
