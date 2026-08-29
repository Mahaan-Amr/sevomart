"use client";

import type { PlatformPermission } from "@sevo/contracts/identity-access/v1";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { platformDestinationsFor } from "../../../../lib/platform-workspace-access";
import styles from "./platform-workspace.module.css";

type PlatformDestination = ReturnType<typeof platformDestinationsFor>[number];

export function PlatformShell({
  children,
  permissions,
}: {
  children: React.ReactNode;
  permissions: readonly PlatformPermission[];
}) {
  const pathname = usePathname();
  const destinations = platformDestinationsFor(permissions);
  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <Link className={styles.brand} href="/platform">
          سوو
          <span>فضای کار پلتفرم</span>
        </Link>
        <PlatformNavigation
          destinations={destinations}
          pathname={pathname}
          className={styles.navigation}
        />
        <LogoutButton />
      </aside>

      <header className={styles.mobileHeader}>
        <Link className={styles.mobileBrand} href="/platform">
          سوو <span>· پلتفرم</span>
        </Link>
        <details className={styles.mobileMenu}>
          <summary>مسئولیت‌ها</summary>
          <PlatformNavigation destinations={destinations} pathname={pathname}>
            <LogoutButton />
          </PlatformNavigation>
        </details>
      </header>

      <div className={styles.content}>{children}</div>
    </div>
  );
}

function PlatformNavigation({
  children,
  className,
  destinations,
  pathname,
}: {
  children?: React.ReactNode;
  className?: string;
  destinations: readonly PlatformDestination[];
  pathname: string;
}) {
  return (
    <nav className={className} aria-label="مسئولیت‌های مجاز پلتفرم">
      {destinations.map((destination) => (
        <PlatformNavigationLink
          key={destination.permission}
          destination={destination}
          pathname={pathname}
        />
      ))}
      {children}
    </nav>
  );
}

function PlatformNavigationLink({
  destination,
  pathname,
}: {
  destination: PlatformDestination;
  pathname: string;
}) {
  const active = pathname.startsWith(destination.href);
  return (
    <Link
      href={destination.href}
      className={active ? styles.activeLink : styles.link}
      aria-current={active ? "page" : undefined}
    >
      <span>{destination.shortLabel}</span>
      <small>{destination.label}</small>
    </Link>
  );
}

function LogoutButton() {
  return (
    <form className={styles.logout} action="/api/platform/auth/logout" method="post">
      <button type="submit">خروج امن</button>
    </form>
  );
}
