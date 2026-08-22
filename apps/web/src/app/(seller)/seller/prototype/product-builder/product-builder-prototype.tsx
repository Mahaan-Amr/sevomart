"use client";

// سه رویکرد برای ساخت کالا، روی مسیر موقت و قابل مقایسه با ?variant=A|B|C

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

import styles from "./product-builder-prototype.module.css";

type VariantKey = "A" | "B" | "C";
type ProductKind = "simple" | "variants";
type Stage = "details" | "images" | "variants" | "preview";

type Draft = {
  name: string;
  description: string;
  kind: ProductKind;
  price: string;
  stock: string;
  colors: string[];
  sizes: string[];
  images: number;
};

const names: Record<VariantKey, string> = {
  A: "قدم‌به‌قدم آرام",
  B: "ویرایش کنار پیش‌نمایش",
  C: "صفحهٔ فشرده و ماتریس گونه‌ها",
};

const initialDraft: Draft = {
  name: "پیراهن لینن تابستانی",
  description: "سبک و خنک، مناسب استفاده روزمره",
  kind: "variants",
  price: "۱٬۲۹۰٬۰۰۰",
  stock: "۸",
  colors: ["زرشکی", "کرم"],
  sizes: ["۳۶", "۳۸", "۴۰"],
  images: 3,
};

export function ProductBuilderPrototype({
  initialVariant,
}: {
  initialVariant?: string;
}) {
  const [draft, setDraft] = useState(initialDraft);
  const [stage, setStage] = useState<Stage>("details");
  const [published, setPublished] = useState(false);
  const variant = isVariant(initialVariant) ? initialVariant : "A";

  return (
    <main className={styles.page}>
      <PrototypeNotice />
      {variant === "A" ? (
        <VariantA
          draft={draft}
          setDraft={setDraft}
          stage={stage}
          setStage={setStage}
          published={published}
          setPublished={setPublished}
        />
      ) : variant === "B" ? (
        <VariantB
          draft={draft}
          setDraft={setDraft}
          published={published}
          setPublished={setPublished}
        />
      ) : (
        <VariantC
          draft={draft}
          setDraft={setDraft}
          published={published}
          setPublished={setPublished}
        />
      )}
      <StateInspector draft={draft} published={published} />
      {process.env.NODE_ENV !== "production" ? (
        <PrototypeSwitcher current={variant} />
      ) : null}
    </main>
  );
}

type VariantProps = {
  draft: Draft;
  setDraft: React.Dispatch<React.SetStateAction<Draft>>;
  published: boolean;
  setPublished: (value: boolean) => void;
};

function VariantA({
  draft,
  setDraft,
  stage,
  setStage,
  published,
  setPublished,
}: VariantProps & { stage: Stage; setStage: (stage: Stage) => void }) {
  const stages: { key: Stage; label: string }[] = [
    { key: "details", label: "مشخصات" },
    { key: "images", label: "تصویرها" },
    { key: "variants", label: "فروش" },
    { key: "preview", label: "بازبینی" },
  ];
  const index = stages.findIndex((item) => item.key === stage);

  return (
    <section className={styles.focusShell} aria-labelledby="variant-a-title">
      <Header
        title="ساخت کالای تازه"
        subtitle="اطلاعات لازم را در چهار قدم کوتاه کامل کنید."
      />
      <ol className={styles.steps} aria-label="مراحل ساخت کالا">
        {stages.map((item, itemIndex) => (
          <li
            key={item.key}
            className={
              item.key === stage
                ? styles.activeStep
                : itemIndex < index
                  ? styles.doneStep
                  : ""
            }
          >
            <button onClick={() => setStage(item.key)}>
              {itemIndex < index ? "✓" : itemIndex + 1} <span>{item.label}</span>
            </button>
          </li>
        ))}
      </ol>
      <div className={styles.focusPanel}>
        {stage === "details" ? <Details draft={draft} setDraft={setDraft} /> : null}
        {stage === "images" ? <Images draft={draft} setDraft={setDraft} /> : null}
        {stage === "variants" ? (
          <Selling draft={draft} setDraft={setDraft} compact={false} />
        ) : null}
        {stage === "preview" ? <Review draft={draft} published={published} /> : null}
      </div>
      <footer className={styles.flowActions}>
        <button className={styles.textButton}>ذخیره پیش‌نویس</button>
        {index > 0 ? (
          <button
            className={styles.secondaryButton}
            onClick={() => setStage(stages[index - 1]?.key ?? "details")}
          >
            قبلی
          </button>
        ) : (
          <span />
        )}
        {stage === "preview" ? (
          <button className={styles.primaryButton} onClick={() => setPublished(true)}>
            انتشار کالا
          </button>
        ) : (
          <button
            className={styles.primaryButton}
            onClick={() => setStage(stages[index + 1]?.key ?? "preview")}
          >
            ادامه
          </button>
        )}
      </footer>
    </section>
  );
}

function VariantB({ draft, setDraft, published, setPublished }: VariantProps) {
  const [section, setSection] = useState<"details" | "images" | "variants">("details");
  return (
    <section className={styles.splitShell} aria-labelledby="variant-b-title">
      <Header
        title="کالای تازه"
        subtitle="تغییرها را همان لحظه از نگاه خریدار ببینید."
      />
      <div className={styles.splitWorkspace}>
        <aside className={styles.sectionNav} aria-label="بخش‌های ویرایش">
          <button
            className={section === "details" ? styles.navActive : ""}
            onClick={() => setSection("details")}
          >
            <span>۱</span> مشخصات
          </button>
          <button
            className={section === "images" ? styles.navActive : ""}
            onClick={() => setSection("images")}
          >
            <span>۲</span> تصویرها <small>{draft.images}/۶</small>
          </button>
          <button
            className={section === "variants" ? styles.navActive : ""}
            onClick={() => setSection("variants")}
          >
            <span>۳</span> قیمت و گونه‌ها <small>{combinationCount(draft)} گونه</small>
          </button>
        </aside>
        <div className={styles.editorPane}>
          {section === "details" ? <Details draft={draft} setDraft={setDraft} /> : null}
          {section === "images" ? <Images draft={draft} setDraft={setDraft} /> : null}
          {section === "variants" ? (
            <Selling draft={draft} setDraft={setDraft} compact />
          ) : null}
        </div>
        <div className={styles.previewPane}>
          <span className={styles.eyebrow}>پیش‌نمایش خریدار</span>
          <ProductPreview draft={draft} />
        </div>
      </div>
      <footer className={styles.stickyActions}>
        <span>
          {published
            ? "کالا منتشر شد و در فروشگاه دیده می‌شود."
            : "همه تغییرها در پیش‌نویس ذخیره شده‌اند."}
        </span>
        <button className={styles.primaryButton} onClick={() => setPublished(true)}>
          انتشار کالا
        </button>
      </footer>
    </section>
  );
}

function VariantC({ draft, setDraft, published, setPublished }: VariantProps) {
  return (
    <section className={styles.denseShell} aria-labelledby="variant-c-title">
      <Header
        title="ساخت کالا"
        subtitle="اطلاعات مشترک بالا؛ قیمت و موجودی هر گونه پایین."
      />
      <div className={styles.denseIntro}>
        <div className={styles.thumb}>
          <span>تصویر اصلی</span>
          <b>＋</b>
        </div>
        <Details draft={draft} setDraft={setDraft} dense />
        <div className={styles.readiness}>
          <span className={styles.eyebrow}>آمادگی انتشار</span>
          <strong>۴ از ۵</strong>
          <p>برای انتشار، تصویر اصلی را اضافه کنید.</p>
        </div>
      </div>
      <div className={styles.inlineToolbar}>
        <div>
          <strong>گونه‌ها</strong>
          <p>هر ترکیب، قیمت و موجودی مستقل دارد.</p>
        </div>
        <KindToggle draft={draft} setDraft={setDraft} />
      </div>
      {draft.kind === "variants" ? (
        <VariantMatrix draft={draft} />
      ) : (
        <SimpleSale draft={draft} setDraft={setDraft} />
      )}
      <footer className={styles.denseActions}>
        <button className={styles.secondaryButton}>پیش‌نمایش</button>
        <span>{published ? "منتشرشده" : "پیش‌نویس · ذخیره خودکار"}</span>
        <button className={styles.primaryButton} onClick={() => setPublished(true)}>
          انتشار کالا
        </button>
      </footer>
    </section>
  );
}

function Header({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <header className={styles.header}>
      <div>
        <span className={styles.brand}>سوو</span>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      <button className={styles.closeButton} aria-label="بستن">
        ×
      </button>
    </header>
  );
}

function Details({
  draft,
  setDraft,
  dense = false,
}: Pick<VariantProps, "draft" | "setDraft"> & { dense?: boolean }) {
  return (
    <div className={dense ? styles.denseFields : styles.formSection}>
      <div className={styles.sectionHeading}>
        <span className={styles.eyebrow}>اطلاعات مشترک</span>
        {!dense ? (
          <>
            <h2>خریدار چه کالایی می‌بیند؟</h2>
            <p>نام روشن و توضیح کوتاه برای تصمیم خرید کافی است.</p>
          </>
        ) : null}
      </div>
      <label>
        نام کالا
        <input
          value={draft.name}
          onChange={(event) =>
            setDraft((current) => ({ ...current, name: event.target.value }))
          }
        />
      </label>
      <label>
        توضیح کوتاه
        <textarea
          rows={dense ? 2 : 3}
          value={draft.description}
          onChange={(event) =>
            setDraft((current) => ({ ...current, description: event.target.value }))
          }
        />
      </label>
      {!dense ? <KindToggle draft={draft} setDraft={setDraft} /> : null}
    </div>
  );
}

function KindToggle({ draft, setDraft }: Pick<VariantProps, "draft" | "setDraft">) {
  return (
    <fieldset className={styles.kindToggle}>
      <legend>این کالا گونه‌های متفاوت دارد؟</legend>
      <button
        className={draft.kind === "simple" ? styles.choiceActive : ""}
        onClick={() => setDraft((current) => ({ ...current, kind: "simple" }))}
      >
        خیر، یک کالا
      </button>
      <button
        className={draft.kind === "variants" ? styles.choiceActive : ""}
        onClick={() => setDraft((current) => ({ ...current, kind: "variants" }))}
      >
        بله، چندگونه
      </button>
    </fieldset>
  );
}

function Images({ draft, setDraft }: Pick<VariantProps, "draft" | "setDraft">) {
  return (
    <div className={styles.formSection}>
      <div className={styles.sectionHeading}>
        <span className={styles.eyebrow}>تصویرها</span>
        <h2>اولین تصویر، تصویر اصلی است</h2>
        <p>تا پنج تصویر تکمیلی می‌توانید اضافه کنید.</p>
      </div>
      <div className={styles.imageRow}>
        {Array.from({ length: draft.images }, (_, index) => (
          <button
            key={index}
            className={index === 0 ? styles.mainImage : styles.imageTile}
            aria-label={`تصویر ${index + 1}`}
          >
            <span>{index === 0 ? "اصلی" : index + 1}</span>
          </button>
        ))}
        {draft.images < 6 ? (
          <button
            className={styles.addImage}
            onClick={() =>
              setDraft((current) => ({ ...current, images: current.images + 1 }))
            }
          >
            ＋<span>افزودن</span>
          </button>
        ) : null}
      </div>
      <p className={styles.hint}>
        برای جابه‌جایی، تصویر را بکشید. انتخاب «اصلی» تصویر اول را تغییر می‌دهد.
      </p>
    </div>
  );
}

function Selling({
  draft,
  setDraft,
  compact,
}: Pick<VariantProps, "draft" | "setDraft"> & { compact: boolean }) {
  return (
    <div className={styles.formSection}>
      <div className={styles.sectionHeading}>
        <span className={styles.eyebrow}>قیمت و موجودی</span>
        <h2>
          {draft.kind === "variants"
            ? "گونه‌ها را از دو محور بسازید"
            : "این کالا چطور فروخته می‌شود؟"}
        </h2>
        <p>
          {draft.kind === "variants"
            ? "سوو ترکیب‌ها را می‌سازد؛ شما قیمت و موجودی هرکدام را بازبینی می‌کنید."
            : "قیمت و موجودی همین کالا را وارد کنید."}
        </p>
      </div>
      {draft.kind === "simple" ? (
        <SimpleSale draft={draft} setDraft={setDraft} />
      ) : (
        <>
          <div className={styles.axisGrid}>
            <Axis label="محور اول" name="رنگ" values={draft.colors} />
            <Axis label="محور دوم · اختیاری" name="اندازه" values={draft.sizes} />
          </div>
          <div className={styles.combinationNote}>
            <strong>{combinationCount(draft)} ترکیب ساخته می‌شود</strong>
            <span>حداکثر ۵۰ ترکیب</span>
          </div>
          {compact ? (
            <VariantMatrix draft={draft} limit={3} />
          ) : (
            <VariantMatrix draft={draft} />
          )}
        </>
      )}
    </div>
  );
}

function Axis({
  label,
  name,
  values,
}: {
  label: string;
  name: string;
  values: string[];
}) {
  return (
    <div className={styles.axis}>
      <span>{label}</span>
      <strong>{name}</strong>
      <div>
        {values.map((value) => (
          <button key={value}>{value} ×</button>
        ))}
        <button className={styles.addChip}>＋ مقدار</button>
      </div>
    </div>
  );
}

function SimpleSale({ draft, setDraft }: Pick<VariantProps, "draft" | "setDraft">) {
  return (
    <div className={styles.saleFields}>
      <label>
        قیمت (تومان)
        <input
          inputMode="numeric"
          value={draft.price}
          onChange={(event) =>
            setDraft((current) => ({ ...current, price: event.target.value }))
          }
        />
      </label>
      <label>
        موجودی
        <input
          inputMode="numeric"
          value={draft.stock}
          onChange={(event) =>
            setDraft((current) => ({ ...current, stock: event.target.value }))
          }
        />
      </label>
      <label>
        شناسه کالا · اختیاری
        <input dir="ltr" placeholder="SKU-001" />
      </label>
    </div>
  );
}

function VariantMatrix({ draft, limit }: { draft: Draft; limit?: number }) {
  const rows = draft.colors
    .flatMap((color) => draft.sizes.map((size) => ({ color, size })))
    .slice(0, limit);
  return (
    <div className={styles.tableWrap}>
      <table>
        <thead>
          <tr>
            <th>گونه</th>
            <th>قیمت (تومان)</th>
            <th>موجودی</th>
            <th>SKU · اختیاری</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${row.color}-${row.size}`}>
              <td>
                <strong>
                  {row.color} · {row.size}
                </strong>
                {index === 0 ? <small>قیمت پایه</small> : null}
              </td>
              <td>
                <input
                  aria-label={`قیمت ${row.color} ${row.size}`}
                  defaultValue={index === 2 ? "۱٬۳۹۰٬۰۰۰" : draft.price}
                />
              </td>
              <td>
                <input
                  aria-label={`موجودی ${row.color} ${row.size}`}
                  defaultValue={index === 4 ? "۰" : draft.stock}
                />
              </td>
              <td>
                <input
                  dir="ltr"
                  aria-label={`شناسه ${row.color} ${row.size}`}
                  placeholder="اختیاری"
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {limit && combinationCount(draft) > limit ? (
        <button className={styles.expandButton}>
          دیدن و ویرایش هر {combinationCount(draft)} گونه
        </button>
      ) : null}
    </div>
  );
}

function Review({ draft, published }: { draft: Draft; published: boolean }) {
  return (
    <div className={styles.reviewGrid}>
      <div>
        <span className={styles.eyebrow}>بازبینی پیش از انتشار</span>
        <h2>{published ? "کالا منتشر شد" : "همه‌چیز آماده است"}</h2>
        <ul>
          <li>نام و توضیح کامل است</li>
          <li>{draft.images} تصویر افزوده شده</li>
          <li>{combinationCount(draft)} گونه با قیمت و موجودی</li>
        </ul>
      </div>
      <ProductPreview draft={draft} />
    </div>
  );
}

function ProductPreview({ draft }: { draft: Draft }) {
  return (
    <article className={styles.productPreview}>
      <div className={styles.productImage}>
        <span>تصویر اصلی</span>
        <i />
      </div>
      <div className={styles.productInfo}>
        <small>پوشاک روزمره</small>
        <h3>{draft.name || "نام کالا"}</h3>
        <p>{draft.description || "توضیح کوتاه کالا"}</p>
        <strong>{draft.price} تومان</strong>
        {draft.kind === "variants" ? (
          <div className={styles.previewOptions}>
            <span>رنگ: زرشکی</span>
            <span>اندازه: ۳۸</span>
          </div>
        ) : null}
        <button>افزودن به سبد</button>
      </div>
    </article>
  );
}

function PrototypeNotice() {
  return (
    <div className={styles.prototypeNotice}>
      نمونهٔ موقت برای تصمیم‌گیری · اطلاعات ذخیره نمی‌شوند
    </div>
  );
}

function StateInspector({ draft, published }: { draft: Draft; published: boolean }) {
  return (
    <details className={styles.stateInspector}>
      <summary>وضعیت نمونه</summary>
      <pre>
        {JSON.stringify(
          {
            ...draft,
            combinations: combinationCount(draft),
            status: published ? "published" : "draft",
          },
          null,
          2,
        )}
      </pre>
    </details>
  );
}

function PrototypeSwitcher({ current }: { current: VariantKey }) {
  const router = useRouter();
  const pathname = usePathname();
  const variants: VariantKey[] = ["A", "B", "C"];
  const move = (offset: number) => {
    const next =
      variants[
        (variants.indexOf(current) + offset + variants.length) % variants.length
      ];
    router.replace(`${pathname}?variant=${next}`, { scroll: false });
  };
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, [contenteditable='true']")) return;
      if (event.key === "ArrowLeft") move(1);
      if (event.key === "ArrowRight") move(-1);
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  });
  return (
    <nav className={styles.switcher} aria-label="انتخاب نسخه نمونه">
      <button onClick={() => move(-1)} aria-label="نسخه قبلی">
        →
      </button>
      <span>
        <b>{current}</b>
        {names[current]}
      </span>
      <button onClick={() => move(1)} aria-label="نسخه بعدی">
        ←
      </button>
    </nav>
  );
}

function combinationCount(draft: Draft) {
  return draft.kind === "simple" ? 1 : draft.colors.length * draft.sizes.length;
}

function isVariant(value?: string): value is VariantKey {
  return value === "A" || value === "B" || value === "C";
}
