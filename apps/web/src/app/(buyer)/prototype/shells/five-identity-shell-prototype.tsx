"use client";

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import styles from "./shell-prototype.module.css";

const variants = ["A", "B", "C"] as const;
const identities = ["buyer", "seller", "applicant", "reviewer", "access"] as const;

type Variant = (typeof variants)[number];
type IdentityKey = (typeof identities)[number];
type Identity = {
  key: IdentityKey;
  name: string;
  shortName: string;
  space: string;
  eyebrow: string;
  start: string;
  startHint: string;
  primaryAction: string;
  notice: string;
  nav: string[];
};

const identityData: Record<IdentityKey, Identity> = {
  buyer: {
    key: "buyer",
    name: "نیلوفر مرادی",
    shortName: "نیلوفر",
    space: "فضای خریدار",
    eyebrow: "صبح بخیر نیلوفر",
    start: "کشف تازه‌ها",
    startHint: "کالاهای تازه از فروشگاه‌های مختلف؛ بدون رتبه‌بندی محبوبیت",
    primaryAction: "دیدن کالای تازه",
    notice: "سفارش ارسال‌شده آبان‌پوش سه روز پیش تحویل پست شد.",
    nav: ["کشف", "دنبال‌شده‌ها", "سفارش‌ها", "گفت‌وگوها"],
  },
  seller: {
    key: "seller",
    name: "سارا نیک‌پی",
    shortName: "سارا",
    space: "فضای کار فروشنده",
    eyebrow: "فروشگاه آبان‌پوش",
    start: "کارهای نزدیک",
    startHint: "فقط کارهایی که اکنون به رسیدگی شما نیاز دارند",
    primaryAction: "آماده‌سازی سفارش",
    notice: "یک سفارش پرداخت‌شده آماده شروع است.",
    nav: ["خانه", "سفارش‌ها", "کالاها", "موجودی", "فروشگاه"],
  },
  applicant: {
    key: "applicant",
    name: "مهسا کریمی",
    shortName: "مهسا",
    space: "درخواست فروشندگی",
    eyebrow: "درخواست شما ثبت شده",
    start: "منتظر بررسی",
    startHint: "اگر اطلاعات بیشتری لازم باشد، همین‌جا به شما خبر می‌دهیم",
    primaryAction: "دیدن جزئیات درخواست",
    notice: "آخرین به‌روزرسانی: امروز، ساعت ۱۰:۲۰",
    nav: ["وضعیت درخواست"],
  },
  reviewer: {
    key: "reviewer",
    name: "آرمان رضایی",
    shortName: "آرمان",
    space: "فضای کار پلتفرم",
    eyebrow: "بررسی درخواست فروشندگی",
    start: "صف بررسی",
    startHint: "فقط درخواست‌هایی که مجوز زنده شما اجازه می‌دهد",
    primaryAction: "بررسی درخواست بعدی",
    notice: "۳ درخواست ارسال‌شده در صف شماست.",
    nav: ["درخواست‌های فروشندگی"],
  },
  access: {
    key: "access",
    name: "لیلا نادری",
    shortName: "لیلا",
    space: "فضای کار پلتفرم",
    eyebrow: "اداره دسترسی‌ها",
    start: "درخواست‌های دسترسی",
    startHint: "اعطا و لغو مجوزها بدون دسترسی عملیاتی ضمنی",
    primaryAction: "بررسی درخواست دسترسی",
    notice: "یک درخواست دسترسی حساس منتظر تصمیم است.",
    nav: ["درخواست‌ها", "عامل‌ها", "سابقه ممیزی"],
  },
};

const variantNames: Record<Variant, string> = {
  A: "فضاهای مستقل",
  B: "مرکز هویت و اقدام بعدی",
  C: "پوسته کارمحور",
};

function cx(...values: Array<string | false | undefined>) {
  return values.filter(Boolean).join(" ");
}

function isVariant(value: string | null): value is Variant {
  return variants.includes(value as Variant);
}

function isIdentity(value: string | null): value is IdentityKey {
  return identities.includes(value as IdentityKey);
}

function Mark() {
  return (
    <span className={styles.mark} aria-label="سوو">
      س
    </span>
  );
}

function IdentityAvatar({ identity }: { identity: Identity }) {
  return (
    <span className={styles.avatar} aria-hidden="true">
      {identity.name.slice(0, 1)}
    </span>
  );
}

function BuyerCanvas() {
  return (
    <div className={styles.productGrid} aria-label="نمونه فید کشف">
      {[
        "تی‌شرت نخی",
        "ماگ دست‌ساز",
        "دفتر نقطه‌ای",
        "کیف پارچه‌ای",
        "شمع سرو",
        "پوستر بهار",
      ].map((name, index) => (
        <article className={styles.product} key={name}>
          <div className={cx(styles.productImage, styles[`tone${(index % 3) + 1}`])} />
          <strong>{name}</strong>
          <span>{["آبان‌پوش", "خانه نارون", "کاغذ و رنگ"][index % 3]}</span>
        </article>
      ))}
    </div>
  );
}

function WorkList({ identity }: { identity: Identity }) {
  const rows: Record<IdentityKey, Array<[string, string, string]>> = {
    buyer: [
      ["آبان‌پوش", "سفارش در راه است", "پیگیری سفارش"],
      ["خانه نارون", "یک کالای تازه منتشر کرد", "دیدن کالا"],
    ],
    seller: [
      ["سفارش ۷۰۲۱", "پرداخت تأیید شده · ۲ قلم", "شروع آماده‌سازی"],
      ["تی‌شرت نخی", "یک گونه رو به اتمام است", "اصلاح موجودی"],
      ["گفت‌وگوی نیلوفر", "پرسش تازه درباره اندازه", "پاسخ دادن"],
    ],
    applicant: [
      ["درخواست فروشندگی", "ارسال‌شده و منتظر بررسی", "دیدن درخواست"],
      ["قدم بعدی", "در صورت نیاز به تکمیل خبر می‌دهیم", "راهنمای بررسی"],
    ],
    reviewer: [
      ["مهسا کریمی", "کارگاه پوشاک روشن · ۲ ساعت پیش", "باز کردن پرونده"],
      ["سامان نظری", "خانه بید · ۴ ساعت پیش", "باز کردن پرونده"],
      ["روژان حاتمی", "استودیو کاغذ · دیروز", "باز کردن پرونده"],
    ],
    access: [
      ["درخواست آرمان رضایی", "دسترسی حساس به یک پرونده · ۳۰ دقیقه", "بررسی درخواست"],
      ["مجوز نازنین توکلی", "لغو مجوز بررسی اختلاف", "دیدن جزئیات"],
      ["بازبینی اضطراری", "یک مورد تا پایان امروز", "رفتن به سابقه"],
    ],
  };

  return (
    <div className={styles.workList}>
      {rows[identity.key].map(([title, detail, action]) => (
        <button type="button" className={styles.workRow} key={title}>
          <span className={styles.rowIcon} aria-hidden="true">
            {title.slice(0, 1)}
          </span>
          <span>
            <strong>{title}</strong>
            <small>{detail}</small>
          </span>
          <em>{action}</em>
        </button>
      ))}
    </div>
  );
}

function VariantA({ identity }: { identity: Identity }) {
  const isBuyer = identity.key === "buyer";
  const isApplicant = identity.key === "applicant";
  const isPlatform = identity.key === "reviewer" || identity.key === "access";

  return (
    <div
      className={cx(
        styles.shellA,
        isBuyer && styles.buyerShell,
        isApplicant && styles.focusShell,
      )}
    >
      {isBuyer ? (
        <header className={styles.buyerHeader}>
          <Mark />
          <nav>
            {identity.nav.map((item, i) => (
              <button className={i === 0 ? styles.active : ""} key={item}>
                {item}
              </button>
            ))}
          </nav>
          <div className={styles.headerActions}>
            <button aria-label="سبد">
              سبد <b>۲</b>
            </button>
            <IdentityAvatar identity={identity} />
          </div>
        </header>
      ) : !isApplicant ? (
        <aside className={styles.sideRail}>
          <div className={styles.railBrand}>
            <Mark />
            <span>{isPlatform ? "سوو · پلتفرم" : "سوو · فروشنده"}</span>
          </div>
          <div className={styles.railIdentity}>
            <IdentityAvatar identity={identity} />
            <span>
              <strong>{identity.shortName}</strong>
              <small>{identity.space}</small>
            </span>
          </div>
          <nav>
            {identity.nav.map((item, i) => (
              <button className={i === 0 ? styles.active : ""} key={item}>
                <span aria-hidden="true">{["⌂", "□", "◇", "◌", "✦"][i]}</span>
                {item}
              </button>
            ))}
          </nav>
          <button className={styles.backToBuyer}>رفتن به فضای خریدار</button>
        </aside>
      ) : null}

      <section className={styles.shellContent}>
        {isApplicant && (
          <div className={styles.focusHeader}>
            <button>بازگشت</button>
            <Mark />
            <span>ذخیره و خروج</span>
          </div>
        )}
        <div className={styles.contentHeading}>
          <span>{identity.eyebrow}</span>
          <h1>{identity.start}</h1>
          <p>{identity.startHint}</p>
        </div>
        {isBuyer ? (
          <BuyerCanvas />
        ) : isApplicant ? (
          <div className={styles.applicationTrack}>
            <div>
              <b>✓</b>
              <span>
                <strong>درخواست ثبت شد</strong>
                <small>امروز، ۱۰:۲۰</small>
              </span>
            </div>
            <div className={styles.currentStep}>
              <b>۲</b>
              <span>
                <strong>بررسی اطلاعات</strong>
                <small>معمولاً تا دو روز کاری</small>
              </span>
            </div>
            <div>
              <b>۳</b>
              <span>
                <strong>نتیجه بررسی</strong>
                <small>از همین صفحه قابل پیگیری است</small>
              </span>
            </div>
          </div>
        ) : (
          <WorkList identity={identity} />
        )}
      </section>

      <nav className={styles.mobileNav}>
        {identity.nav.slice(0, 5).map((item, i) => (
          <button className={i === 0 ? styles.active : ""} key={item}>
            <span>{["⌂", "□", "◇", "◌", "✦"][i]}</span>
            {item}
          </button>
        ))}
      </nav>
    </div>
  );
}

function VariantB({ identity }: { identity: Identity }) {
  return (
    <div className={styles.shellB}>
      <header className={styles.hubHeader}>
        <Mark />
        <span>مرکز هویت سوو</span>
        <button className={styles.compactIdentity}>
          <IdentityAvatar identity={identity} />
          {identity.shortName}
        </button>
      </header>
      <div className={styles.hubLayout}>
        <aside className={styles.identityDock}>
          <span className={styles.dockLabel}>اکنون در</span>
          <div className={styles.bigIdentity}>
            <IdentityAvatar identity={identity} />
            <strong>{identity.name}</strong>
            <small>{identity.space}</small>
          </div>
          <div className={styles.placeList}>
            <button className={styles.selectedPlace}>
              <b>●</b>
              <span>
                <strong>{identity.space}</strong>
                <small>{identity.start}</small>
              </span>
            </button>
            {identity.key === "seller" && (
              <button>
                <b>○</b>
                <span>
                  <strong>فضای خریدار</strong>
                  <small>خرید با همین هویت</small>
                </span>
              </button>
            )}
            {identity.key === "applicant" && (
              <button>
                <b>○</b>
                <span>
                  <strong>فضای خریدار</strong>
                  <small>درخواست شما جدا پیگیری می‌شود</small>
                </span>
              </button>
            )}
          </div>
          <p>هر فضا جداست؛ هویت شما یکی است.</p>
        </aside>
        <main className={styles.hubMain}>
          <div className={styles.nextAction}>
            <span>پیشنهاد برای همین حالا</span>
            <h1>{identity.primaryAction}</h1>
            <p>{identity.notice}</p>
            <button>
              {identity.primaryAction}
              <span>←</span>
            </button>
          </div>
          <section className={styles.hubSection}>
            <div className={styles.sectionTitle}>
              <h2>{identity.start}</h2>
              <button>دیدن همه</button>
            </div>
            {identity.key === "buyer" ? (
              <BuyerCanvas />
            ) : (
              <WorkList identity={identity} />
            )}
          </section>
        </main>
      </div>
    </div>
  );
}

function VariantC({ identity }: { identity: Identity }) {
  return (
    <div className={styles.shellC}>
      <header className={styles.commandHeader}>
        <div>
          <Mark />
          <span>
            <strong>{identity.space}</strong>
            <small>{identity.name}</small>
          </span>
        </div>
        <button className={styles.commandButton}>
          <span>⌘</span> رفتن به… <kbd>⌘ K</kbd>
        </button>
        <button className={styles.avatarButton}>
          <IdentityAvatar identity={identity} />
        </button>
      </header>
      <div className={styles.commandBody}>
        <div className={styles.contextLine}>
          <button>{identity.space}</button>
          <span>/</span>
          <strong>{identity.start}</strong>
        </div>
        <section className={styles.focusTask}>
          <span className={styles.taskNumber}>۰۱</span>
          <div className={styles.taskCopy}>
            <span>{identity.eyebrow}</span>
            <h1>{identity.primaryAction}</h1>
            <p>{identity.notice}</p>
          </div>
          <button className={styles.roundAction} aria-label={identity.primaryAction}>
            ←
          </button>
        </section>
        <section className={styles.compactQueue}>
          <div className={styles.sectionTitle}>
            <h2>{identity.key === "buyer" ? "برای دیدن" : "پس از آن"}</h2>
            <span>{identity.nav.join(" · ")}</span>
          </div>
          {identity.key === "buyer" ? (
            <BuyerCanvas />
          ) : (
            <WorkList identity={identity} />
          )}
        </section>
      </div>
      <nav className={styles.commandMobileNav}>
        <button className={styles.active}>اکنون</button>
        <button>رفتن به…</button>
        <button>هویت</button>
      </nav>
    </div>
  );
}

function PrototypeControls({
  variant,
  identity,
}: {
  variant: Variant;
  identity: IdentityKey;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  function update(nextVariant: Variant, nextIdentity: IdentityKey) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("variant", nextVariant);
    params.set("identity", nextIdentity);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  function move(direction: -1 | 1) {
    const index = variants.indexOf(variant);
    update(
      variants[(index + direction + variants.length) % variants.length] ?? "A",
      identity,
    );
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, [contenteditable='true']")) return;
      if (event.key === "ArrowLeft") move(-1);
      if (event.key === "ArrowRight") move(1);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  if (process.env.NODE_ENV === "production") return null;

  return (
    <aside className={styles.prototypeControls} aria-label="کنترل نمونه دورریختنی">
      <div className={styles.identityControls}>
        {identities.map((key) => (
          <button
            key={key}
            className={key === identity ? styles.current : ""}
            onClick={() => update(variant, key)}
          >
            {identityData[key].shortName}
          </button>
        ))}
      </div>
      <div className={styles.variantControls}>
        <button onClick={() => move(-1)} aria-label="طرح قبلی">
          →
        </button>
        <span>
          <b>طرح {variant}</b>
          <small>{variantNames[variant]}</small>
        </span>
        <button onClick={() => move(1)} aria-label="طرح بعدی">
          ←
        </button>
      </div>
    </aside>
  );
}

export function FiveIdentityShellPrototype() {
  const searchParams = useSearchParams();
  const rawVariant = searchParams.get("variant");
  const rawIdentity = searchParams.get("identity");
  const variant = isVariant(rawVariant) ? rawVariant : "A";
  const identityKey = isIdentity(rawIdentity) ? rawIdentity : "buyer";
  const identity = identityData[identityKey];

  return (
    <main className={styles.prototype}>
      <div className={styles.prototypeNote}>
        نمونه دورریختنی · داده‌ها و اقدام‌ها نمایشی‌اند
      </div>
      {variant === "A" && <VariantA identity={identity} />}
      {variant === "B" && <VariantB identity={identity} />}
      {variant === "C" && <VariantC identity={identity} />}
      <PrototypeControls variant={variant} identity={identityKey} />
    </main>
  );
}
