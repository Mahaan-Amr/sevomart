"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useFeedWorkspace } from "./feed-workspace";
import styles from "./discovery.module.css";

export function FeedTabs() {
  const pathname = usePathname();
  const { rememberScroll } = useFeedWorkspace();
  return (
    <nav className={styles.feedTabs} aria-label="فید فروشگاه‌ها">
      {[
        { href: "/discover", label: "کشف" },
        { href: "/following", label: "دنبال‌شده‌ها" },
      ].map(({ href, label }) => (
        <Link
          href={href}
          key={href}
          aria-current={pathname === href ? "page" : undefined}
          scroll={false}
          onClick={() =>
            rememberScroll(
              pathname === "/following" ? "following" : "discovery",
              window.scrollY,
            )
          }
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
