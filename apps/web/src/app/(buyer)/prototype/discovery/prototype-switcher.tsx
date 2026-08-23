"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";

import styles from "./prototype.module.css";

export const prototypeVariants = ["A", "B", "C"] as const;
export type PrototypeVariant = (typeof prototypeVariants)[number];

const variantNames: Record<PrototypeVariant, string> = {
  A: "فید آرام",
  B: "کالا در مرکز",
  C: "کشف کالامحور",
};

function isPrototypeVariant(value: string | null): value is PrototypeVariant {
  return prototypeVariants.includes(value as PrototypeVariant);
}

export function usePrototypeVariant() {
  const searchParams = useSearchParams();
  const value = searchParams.get("variant");
  return isPrototypeVariant(value) ? value : "A";
}

export function PrototypeSwitcher({ current }: { current: PrototypeVariant }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function select(variant: PrototypeVariant) {
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.set("variant", variant);
    window.location.replace(pathname + "?" + nextParams.toString());
  }

  function move(direction: -1 | 1) {
    const currentIndex = prototypeVariants.indexOf(current);
    const nextIndex =
      (currentIndex + direction + prototypeVariants.length) % prototypeVariants.length;
    select(prototypeVariants[nextIndex] ?? "A");
  }

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, [contenteditable='true']")) return;
      if (event.key === "ArrowLeft") move(-1);
      if (event.key === "ArrowRight") move(1);
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  if (process.env.NODE_ENV === "production") return null;

  return (
    <nav className={styles.switcher} aria-label="تغییر طرح نمونه">
      <button type="button" onClick={() => move(-1)} aria-label="طرح قبلی">
        ←
      </button>
      <div className={styles.switcherCenter}>
        <span dir="rtl">
          طرح {current} · {variantNames[current]}
        </span>
        <div className={styles.variantButtons} aria-label="انتخاب مستقیم طرح">
          {prototypeVariants.map((variant) => (
            <button
              type="button"
              key={variant}
              className={variant === current ? styles.currentVariant : ""}
              aria-pressed={variant === current}
              onClick={() => select(variant)}
            >
              {variant}
            </button>
          ))}
        </div>
      </div>
      <button type="button" onClick={() => move(1)} aria-label="طرح بعدی">
        →
      </button>
    </nav>
  );
}
