export type StorefrontFixture =
  | { state: "loading" }
  | { state: "error" }
  | {
      state: "ready";
      identity: {
        name: string;
        description: string;
        logoMonogram: string;
        accent: string;
        coverStart: string;
        coverEnd: string;
      };
      shipping: string;
      returns: string;
    };

const defaultIdentity = {
  name: "فروشگاه سپیدار",
  description: "انتخاب‌های ساده برای خانه‌ای آرام‌تر.",
  logoMonogram: "س",
  accent: "#A41439",
  coverStart: "#F6E3E9",
  coverEnd: "#EAD5DB",
} as const;

const purchaseTerms = {
  shipping: "ارسال با پست پیشتاز",
  returns: "تا ۷ روز پس از تحویل",
} as const;

const errorFixture: StorefrontFixture = { state: "error" };

const storefrontFixtures: Record<string, StorefrontFixture> = {
  "fixture-loading": { state: "loading" },
  "fixture-error": errorFixture,
  "fixture-empty": {
    state: "ready",
    identity: defaultIdentity,
    ...purchaseTerms,
  },
  "fixture-short": {
    state: "ready",
    identity: {
      ...defaultIdentity,
      name: "خانه سرو",
      description: "چیزهای کوچک و کاربردی برای خانه.",
    },
    ...purchaseTerms,
  },
  "fixture-long": {
    state: "ready",
    identity: {
      ...defaultIdentity,
      name: "فروشگاه دست‌سازه‌های کوچک و دوست‌داشتنی ماه‌نقره‌ای تهران",
      description:
        "اینجا هر دست‌سازه با حوصله و در شمار محدود آماده می‌شود؛ از انتخاب مواد اولیه تا بسته‌بندی نهایی، تلاش می‌کنیم توضیح هر کالا روشن باشد تا پیش از سفارش بدانید چه چیزی و در چه زمانی به دستتان می‌رسد.",
    },
    ...purchaseTerms,
  },
  "fixture-custom": {
    state: "ready",
    identity: {
      name: "استودیو زرشک",
      description: "ساخته‌های پارچه‌ای با رنگ‌های گرم و جزئیات دست‌دوز.",
      logoMonogram: "ز",
      accent: "#760B29",
      coverStart: "#EEC8D3",
      coverEnd: "#B75B75",
    },
    ...purchaseTerms,
  },
};

export function getStorefrontFixture(slug: string): StorefrontFixture | undefined {
  return storefrontFixtures[slug];
}
