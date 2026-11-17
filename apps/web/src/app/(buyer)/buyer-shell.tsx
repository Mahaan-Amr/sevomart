"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import type { IdentitySession } from "@sevo/contracts/identity-access/v1";

import { loginHref } from "../../lib/navigation";
import { useFeedWorkspace } from "./(browse)/feed-workspace";
import { useTheme } from "../theme";
import styles from "./buyer-shell.module.css";

export function BuyerShell({
  children,
  session,
  seller = false,
}: {
  children: ReactNode;
  session?: IdentitySession;
  seller?: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const query = useSearchParams().toString();
  const [endingSession, setEndingSession] = useState(false);
  const [signOutError, setSignOutError] = useState(false);
  const { theme, toggle } = useTheme();
  const dark = theme === "dark";
  const home = pathname === "/";
  const themeAction = dark ? "حالت روشن" : "حالت تاریک";
  const { clearRestoredFocus, resetWorkspace, restored, restoredFocus, scrollFor } =
    useFeedWorkspace();
  const returnTo = `${pathname}${query ? `?${query}` : ""}`;
  const activeFeed = home
    ? session
      ? "following"
      : "discovery"
    : pathname === "/discover"
      ? "discovery"
      : pathname === "/following"
        ? "following"
        : null;

  async function signOut() {
    setEndingSession(true);
    setSignOutError(false);
    try {
      const response = await fetch("/api/auth/session", { method: "DELETE" });
      if (response.ok) {
        resetWorkspace();
        if (pathname === "/conversations" || pathname.startsWith("/conversations/")) {
          window.location.replace(loginHref("/conversations", "/"));
        } else router.refresh();
      } else setSignOutError(true);
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
    <div className={styles.shell} data-buyer-home={home ? "" : undefined}>
      <a className={styles.skipLink} href="#buyer-content">
        رفتن به محتوای صفحه
      </a>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <Link href="/" className={styles.brand} aria-label="سوو؛ کشف تازه‌ها">
            سوو
          </Link>
          <div className={styles.actions}>
            <Link href="/cart">سبد</Link>
            {home ? (
              <button
                type="button"
                className={styles.themeToggle}
                aria-label={themeAction}
                title={themeAction}
                onClick={toggle}
              >
                <svg
                  viewBox="0 0 24 24"
                  width="22"
                  height="22"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  {dark ? (
                    <>
                      <circle cx="12" cy="12" r="4" />
                      <path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.4 1.4m11.2 11.2L19 19M5 19l1.4-1.4M17.6 6.4 19 5" />
                    </>
                  ) : (
                    <path d="M21 13.2A9.2 9.2 0 0 1 10.8 3 9.1 9.1 0 1 0 21 13.2Z" />
                  )}
                </svg>
              </button>
            ) : null}
            <details className={styles.identity}>
              <summary>
                {session ? (
                  <bdi className={styles.mobileNumber} dir="ltr">
                    {formatMaskedMobile(session.maskedMobile)}
                  </bdi>
                ) : (
                  "هویت سوو"
                )}
              </summary>
              <div className={styles.identityMenu}>
                {session ? (
                  <>
                    <Link href="/orders">سفارش‌ها</Link>
                    <Link href="/account/addresses">نشانی‌ها</Link>
                    {seller ? (
                      <Link href="/seller">فضای فروشنده</Link>
                    ) : (
                      <Link href="/seller/start">درخواست فروشندگی</Link>
                    )}
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
