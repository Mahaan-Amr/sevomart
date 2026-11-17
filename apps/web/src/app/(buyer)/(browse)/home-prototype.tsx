/* Throwaway home comparison: A current hierarchy, B photo-first, C compact shelf. */
"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import styles from "./home-prototype.module.css";

const variants = ["A", "B", "C"] as const;
type Variant = (typeof variants)[number];

const names = { A: "چیدمان فعلی", B: "فید تصویری", C: "مرور فشرده" };
const items = [
  {
    photo: "scarf",
    store: "آبان‌پوش",
    title: "شال نخی سبز",
    price: 215000,
    unavailable: true,
  },
  { photo: "mug", store: "خانه نارون", title: "ماگ سرامیکی دست‌ساز", price: 390000 },
  { photo: "tote", store: "آبان‌پوش", title: "کیف پارچه‌ای زیتونی", price: 480000 },
  { photo: "candle", store: "خانه نارون", title: "شمع در شیشه کهربایی", price: 295000 },
];
type Item = (typeof items)[number];

const destinations = [
  ["خانه", "M3 10 12 3l9 7v11H3z M9 21v-7h6v7"],
  ["کشف", "M21 21l-5-5 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0"],
  ["سبد", "M4 8h16l-1 13H5z M9 9V6a3 3 0 0 1 6 0v3"],
  ["سفارش‌ها", "M6 3h12v18l-3-2-3 2-3-2-3 2Z M9 8h6 M9 12h6"],
  ["گفت‌وگوها", "M20 11a8 8 0 0 1-12 7l-4 2 1-5a8 8 0 1 1 15-4Z M9 11h6"],
] as const;
const fa = new Intl.NumberFormat("fa-IR");
const photo = (item: Item) => "/prototype-home/" + item.photo + ".webp";

function ProductImage({ item, priority }: { item: Item; priority?: boolean }) {
  return (
    <Image
      unoptimized
      src={photo(item)}
      alt={item.title}
      width={627}
      height={627}
      loading={priority ? "eager" : "lazy"}
    />
  );
}

function Offer({ item }: { item: Item }) {
  return (
    <span className={styles.offer}>
      <span>{fa.format(item.price)} تومان</span>
      {item.unavailable && <span className={styles.unavailable}>ناموجود</span>}
    </span>
  );
}

function Chevron({ right = false }: { right?: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={right ? "m6 4 4 4-4 4" : "m10 4-4 4 4 4"} />
    </svg>
  );
}

export function HomePrototype({ variant, dark }: { variant: Variant; dark: boolean }) {
  const [layout, setLayout] = useState(variant);
  const [night, setNight] = useState(dark);
  const [screen, setScreen] = useState<(typeof destinations)[number][0]>("خانه");
  const [store, setStore] = useState<string>();
  const [item, setItem] = useState<Item>();
  const [dialog, setDialog] = useState<HTMLDialogElement | null>(null);

  function select(next: Variant, nextNight: boolean) {
    setLayout(next);
    setNight(nextNight);
    const params = new URLSearchParams({ variant: next });
    if (nextNight) params.set("theme", "dark");
    window.history.replaceState(null, "", "/?" + params);
  }

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.defaultPrevented ||
        dialog?.open ||
        (event.target instanceof HTMLElement &&
          event.target.closest("input, textarea, select, [contenteditable]"))
      )
        return;
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const step = event.key === "ArrowLeft" ? -1 : 1;
      select(
        variants[
          (variants.indexOf(layout) + step + variants.length) % variants.length
        ]!,
        night,
      );
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [dialog, layout, night]);

  useEffect(() => {
    if (item && dialog && !dialog.open) dialog.showModal();
  }, [dialog, item]);

  function navigate(next: typeof screen, nextStore?: string) {
    setScreen(next);
    setStore(nextStore);
    window.scrollTo({ top: 0, behavior: "instant" });
  }

  const isHome = screen === "خانه";
  const showingItems = isHome || screen === "کشف";
  const visible = store ? items.filter((product) => product.store === store) : items;
  const view = !isHome ? "grid" : layout;

  return (
    <div
      className={styles.preview}
      data-theme={night ? "dark" : "light"}
      data-layout={layout}
    >
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <button className={styles.brand} onClick={() => navigate("خانه")}>
            سوو
          </button>
          <div className={styles.headerActions}>
            {layout === "A" && <button onClick={() => navigate("سبد")}>سبد</button>}
            <a href="/login">هویت سوو</a>
            <button
              className={styles.theme}
              aria-label={night ? "حالت روشن" : "حالت تاریک"}
              title={night ? "حالت روشن" : "حالت تاریک"}
              onClick={() => select(layout, !night)}
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
                {night ? (
                  <>
                    <circle cx="12" cy="12" r="4" />
                    <path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.4 1.4m11.2 11.2L19 19M5 19l1.4-1.4M17.6 6.4 19 5" />
                  </>
                ) : (
                  <path d="M21 13.2A9.2 9.2 0 0 1 10.8 3 9.1 9.1 0 1 0 21 13.2Z" />
                )}
              </svg>
            </button>
          </div>
        </div>
      </header>

      <section className={styles.content} aria-label={store ?? screen}>
        <h1 className={view === "B" ? styles.visuallyHidden : undefined}>
          {store ?? screen}
        </h1>
        {view === "A" && (
          <p className={styles.freshness}>به‌روزرسانی تا ۱۴۰۵/۰۸/۲۶، ۱۲:۲۶</p>
        )}

        {showingItems ? (
          <div className={styles.products} data-view={view}>
            {visible.map((product, index) => (
              <article key={product.photo} className={styles.product}>
                {(view === "A" || view === "B") && (
                  <button
                    className={styles.store}
                    onClick={() => navigate("کشف", product.store)}
                  >
                    <span className={styles.avatar} aria-hidden="true">
                      {product.store[0]}
                    </span>
                    {product.store}
                    {view === "B" && (
                      <span className={styles.chevron}>
                        <Chevron />
                      </span>
                    )}
                  </button>
                )}
                <button
                  className={styles.photo}
                  onClick={() => setItem(product)}
                  aria-label={"دیدن " + product.title}
                >
                  <ProductImage item={product} priority={index === 0} />
                </button>
                <div className={styles.details}>
                  {view === "C" && (
                    <button
                      className={styles.store}
                      onClick={() => navigate("کشف", product.store)}
                    >
                      {product.store}
                    </button>
                  )}
                  <button className={styles.title} onClick={() => setItem(product)}>
                    {product.title}
                  </button>
                  <Offer item={product} />
                  {view === "A" && (
                    <button className={styles.cta} onClick={() => setItem(product)}>
                      دیدن کالا
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className={styles.empty}>
            <p>
              {screen === "سبد"
                ? "سبد شما خالی است."
                : "برای دیدن این بخش وارد سوو شوید."}
            </p>
            {screen === "سبد" ? (
              <button className={styles.cta} onClick={() => navigate("کشف")}>
                رفتن به کشف
              </button>
            ) : (
              <a
                className={styles.cta}
                href={screen === "سفارش‌ها" ? "/orders" : "/conversations"}
              >
                ادامه در سوو
              </a>
            )}
          </div>
        )}
      </section>

      <nav className={styles.nav} aria-label="ناوبری نمونه خریدار">
        {destinations.map(([label, d]) => (
          <button
            key={label}
            aria-current={screen === label ? "page" : undefined}
            onClick={() => navigate(label)}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d={d} />
            </svg>
            <span>{label}</span>
          </button>
        ))}
      </nav>

      <div className={styles.switcher} role="group" aria-label="کنترل نمونه طراحی">
        <button
          aria-label="طرح قبلی"
          onClick={() => select(variants[(variants.indexOf(layout) + 2) % 3]!, night)}
        >
          <Chevron right />
        </button>
        <span aria-live="polite">
          <bdi>{layout}</bdi> · {names[layout]}
        </span>
        <button
          aria-label="طرح بعدی"
          onClick={() => select(variants[(variants.indexOf(layout) + 1) % 3]!, night)}
        >
          <Chevron />
        </button>
      </div>

      <dialog
        className={styles.dialog}
        ref={setDialog}
        onClose={() => setItem(undefined)}
        aria-label={item?.title}
      >
        {item && (
          <>
            <form method="dialog">
              <button aria-label="بستن">×</button>
            </form>
            <ProductImage item={item} />
            <div className={styles.details}>
              <p>{item.store}</p>
              <h2>{item.title}</h2>
              <Offer item={item} />
              <p>کالای نمونه</p>
            </div>
          </>
        )}
      </dialog>
    </div>
  );
}
