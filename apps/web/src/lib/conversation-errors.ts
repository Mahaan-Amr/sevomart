import { conversationErrorV1Contract } from "@sevo/contracts/conversations/v1";

export type ConversationErrorPresentation = {
  code: string;
  message: string;
  nextStep: string;
};

export function conversationErrorPresentation(
  body: unknown,
): ConversationErrorPresentation {
  const parsed = conversationErrorV1Contract.safeParse(body);
  if (!parsed.success) return unknownError;
  const error = parsed.data;
  switch (error.code) {
    case "UNAUTHENTICATED":
      return present(
        error.code,
        "برای ادامه وارد سوو شوید.",
        "پس از ورود همین کار ادامه پیدا می‌کند.",
      );
    case "IDENTITY_INACTIVE":
      return present(
        error.code,
        "هویت سوو اکنون فعال نیست.",
        "وضعیت هویت را بررسی و سپس دوباره تلاش کنید.",
      );
    case "FORBIDDEN_CONTEXT":
      return present(
        error.code,
        "امکان شروع گفت‌وگو در این زمینه نیست.",
        "به صفحه قبلی برگردید و زمینه درست را انتخاب کنید.",
      );
    case "CONTEXT_NOT_FOUND":
      return present(
        error.code,
        "زمینه این گفت‌وگو پیدا نشد.",
        "به صفحه قبلی برگردید و دوباره شروع کنید.",
      );
    case "CONTEXT_UNAVAILABLE":
      return present(
        error.code,
        "این زمینه فعلاً برای گفت‌وگو آماده نیست.",
        "کمی بعد از همان صفحه دوباره تلاش کنید.",
      );
    case "FORBIDDEN_CONVERSATION":
      return present(
        error.code,
        "به این گفت‌وگو دسترسی ندارید.",
        "به فهرست گفت‌وگوهای خودتان برگردید.",
      );
    case "CONVERSATION_NOT_FOUND":
      return present(
        error.code,
        "این گفت‌وگو پیدا نشد.",
        "به فهرست گفت‌وگوها برگردید.",
      );
    case "INVALID_CURSOR":
      return present(
        error.code,
        "نشانی ادامه این فهرست معتبر نیست.",
        "فهرست را از ابتدا تازه کنید.",
      );
    case "CURSOR_EXPIRED":
      return present(
        error.code,
        "مهلت ادامه این فهرست تمام شده است.",
        "فهرست را از ابتدا تازه کنید.",
      );
    case "IDEMPOTENCY_CONFLICT":
      return present(
        error.code,
        "این تلاش با درخواست قبلی سازگار نیست.",
        "از صفحه قبلی دوباره اقدام کنید.",
      );
    case "IDEMPOTENCY_IN_PROGRESS":
      return present(
        error.code,
        "درخواست قبلی هنوز در حال انجام است.",
        `${new Intl.NumberFormat("fa-IR").format(error.details.retryAfterSeconds)} ثانیه صبر کنید و دوباره تلاش کنید.`,
      );
    case "MESSAGE_REJECTED":
      return present(
        error.code,
        "پیام پذیرفته نشد.",
        "متن را بررسی کنید و دوباره بفرستید.",
      );
    case "MEDIA_NOT_READY":
      return present(
        error.code,
        "رسانه هنوز آماده نیست.",
        "پس از آماده‌شدن رسانه دوباره تلاش کنید.",
      );
  }
}

const unknownError = {
  code: "UNKNOWN",
  message: "گفت‌وگو در دسترس نیست.",
  nextStep: "اتصال را بررسی کنید و دوباره تلاش کنید.",
} as const;

function present(code: string, message: string, nextStep: string) {
  return { code, message, nextStep };
}
