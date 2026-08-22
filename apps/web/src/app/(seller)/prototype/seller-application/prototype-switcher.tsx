"use client";

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import styles from "./prototype.module.css";

export const prototypeVariants = ["A", "B", "C"] as const;
export type PrototypeVariant = (typeof prototypeVariants)[number];

const variantNames: Record<PrototypeVariant, string> = {
  A: "مسیر خطی آرام",
  B: "گفت‌وگوی کوتاه",
  C: "پرونده شفاف",
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
  const router = useRouter();
  const searchParams = useSearchParams();

  function select(variant: PrototypeVariant) {
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.set("variant", variant);
    router.replace(pathname + "?" + nextParams.toString(), { scroll: false });
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
      <div>
        <span>
          طرح {current} · {variantNames[current]}
        </span>
        <small>کلیدهای ← و →</small>
      </div>
      <button type="button" onClick={() => move(1)} aria-label="طرح بعدی">
        →
      </button>
    </nav>
  );
}
