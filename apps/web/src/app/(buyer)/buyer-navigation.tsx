"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { useFeedWorkspace } from "./(browse)/feed-workspace";
import {
  activeBuyerDestination,
  showBuyerNavigation,
  type BuyerDestination,
} from "./buyer-navigation-routes";
import styles from "./buyer-navigation.module.css";

const destinations: Array<{ href: BuyerDestination; label: string }> = [
  { href: "/", label: "کشف" },
  { href: "/following", label: "دنبال‌شده‌ها" },
  { href: "/cart", label: "سبد" },
  { href: "/orders", label: "سفارش‌ها" },
  { href: "/conversations", label: "گفت‌وگوها" },
];

export function BuyerNavigation() {
  const pathname = usePathname();
  const { rememberScroll } = useFeedWorkspace();
  if (!showBuyerNavigation(pathname)) return null;
  const active = activeBuyerDestination(pathname);

  return (
    <div className={styles.area}>
      <nav className={styles.bar} aria-label="فضای خریدار">
        {destinations.map(({ href, label }) => (
          <Link
            key={href}
            href={href}
            aria-label={label}
            title={label}
            aria-current={active === href ? "page" : undefined}
            scroll={href !== "/" && href !== "/following"}
            onClick={() => {
              if (pathname === "/" || pathname === "/following") {
                rememberScroll(
                  pathname === "/" ? "discovery" : "following",
                  window.scrollY,
                );
              }
            }}
          >
            <NavigationIcon destination={href} />
          </Link>
        ))}
      </nav>
    </div>
  );
}

function NavigationIcon({ destination }: { destination: BuyerDestination }) {
  const shared = {
    "aria-hidden": true as const,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  switch (destination) {
    case "/":
      return (
        <svg {...shared}>
          <path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V10Z" />
          <path d="M9 21v-7h6v7" />
        </svg>
      );
    case "/following":
      return (
        <svg {...shared}>
          <path d="M20.7 4.8a5.5 5.5 0 0 0-7.8 0L12 5.7l-.9-.9a5.5 5.5 0 0 0-7.8 7.8L12 21l8.7-8.4a5.5 5.5 0 0 0 0-7.8Z" />
        </svg>
      );
    case "/cart":
      return (
        <svg {...shared}>
          <path d="M4 9h16l-1.4 11H5.4L4 9Z" />
          <path d="M9 10V7a3 3 0 0 1 6 0v3" />
        </svg>
      );
    case "/orders":
      return (
        <svg {...shared}>
          <path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z" />
          <path d="M9 8h6M9 12h6" />
        </svg>
      );
    case "/conversations":
      return (
        <svg {...shared}>
          <path d="M20 11.5a8 8 0 0 1-8 8 8.7 8.7 0 0 1-3.3-.7L4 20l1.2-4.7A8 8 0 1 1 20 11.5Z" />
          <path d="M8.5 11.5h7" />
        </svg>
      );
  }
}
