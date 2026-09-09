"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import type { IdentitySession } from "@sevo/contracts/identity-access/v1";

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

export function BuyerShell({
  children,
  session,
}: {
  children: ReactNode;
  session?: IdentitySession;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const query = useSearchParams().toString();
  const [endingSession, setEndingSession] = useState(false);
  const [signOutError, setSignOutError] = useState(false);
  const { clearRestoredFocus, rememberScroll, restored, restoredFocus, scrollFor } =
    useFeedWorkspace();
  const returnTo = `${pathname}${query ? `?${query}` : ""}`;
  const activeFeed =
    pathname === "/" ? "discovery" : pathname === "/following" ? "following" : null;

  async function signOut() {
    setEndingSession(true);
    setSignOutError(false);
    try {
      const response = await fetch("/api/auth/session", { method: "DELETE" });
      if (response.ok) router.refresh();
      else setSignOutError(true);
    } catch {
      setSignOutError(true);
    } finally {
      setEndingSession(false);
    }
  }

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
      } else if (restoredFocus) {
        const origin = document.querySelector<HTMLElement>(
          `[data-feed-focus="${CSS.escape(restoredFocus)}"]`,
        );
        if (origin) {
          origin.focus({ preventScroll: true });
          clearRestoredFocus();
        }
      }
    };
    frame = requestAnimationFrame(restore);
    return () => cancelAnimationFrame(frame);
  }, [activeFeed, clearRestoredFocus, restored, restoredFocus, scrollFor]);

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
            <summary>
              {session ? formatMaskedMobile(session.maskedMobile) : "هویت سوو"}
            </summary>
            <div className={styles.identityMenu}>
              {session ? (
                <>
                  <Link href="/orders">سفارش‌ها</Link>
                  <Link href="/account/addresses">نشانی‌ها</Link>
                  <Link href="/seller/start">درخواست فروشندگی</Link>
                  <button type="button" onClick={signOut} disabled={endingSession}>
                    {endingSession ? "در حال خروج…" : "خروج"}
                  </button>
                  {signOutError ? (
                    <p className={styles.identityError} role="alert">
                      خروج انجام نشد. دوباره تلاش کنید.
                    </p>
                  ) : null}
                </>
              ) : (
                <>
                  <Link href="/seller/start">فروشنده شوید</Link>
                  <Link href={loginHref(returnTo, returnTo)}>ورود و ادامه</Link>
                </>
              )}
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

function formatMaskedMobile(value: string) {
  return value.replace(/\d/g, (digit) => "۰۱۲۳۴۵۶۷۸۹"[Number(digit)] ?? digit);
}
