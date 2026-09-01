import type { FeedKind } from "./feed-workspace";

export type FeedErrorState = {
  message: string;
  retryable: boolean;
  goToDiscovery?: boolean;
};

export function cursorNotice(code: string, kind: FeedKind) {
  switch (code) {
    case "INVALID_CURSOR":
      return "ادامه این فید معتبر نبود؛ از ابتدا شروع کردیم.";
    case "CURSOR_EXPIRED":
      return "این فید قدیمی بود؛ تازه‌اش کردیم.";
    case "FEED_CURSOR_STALE":
      return kind === "following"
        ? "فروشگاه‌های دنبال‌شده تغییر کردند؛ فید را تازه کردیم."
        : "فید تغییر کرده بود؛ تازه‌اش کردیم.";
    default:
      return "";
  }
}

export function classifyFeedError(code: string): FeedErrorState {
  switch (code) {
    case "IDENTITY_INACTIVE":
      return {
        message: "دسترسی این هویت به دنبال‌شده‌ها فعال نیست.",
        retryable: false,
        goToDiscovery: true,
      };
    case "PROJECTION_UNAVAILABLE":
      return {
        message: "فید فعلاً آماده نیست. کمی بعد دوباره تلاش کنید.",
        retryable: true,
      };
    default:
      return {
        message: "کالاها بارگیری نشدند. دوباره تلاش کنید.",
        retryable: true,
      };
  }
}
