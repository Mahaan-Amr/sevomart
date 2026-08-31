import {
  sellerDisputeViewContract,
  type DisputeStatus,
} from "@sevo/contracts/problem-follow-up/v1";

export type SellerDispute = ReturnType<typeof sellerDisputeViewContract.parse>;
export type { DisputeStatus };

export function nearestSellerResponseDispute(
  disputes: readonly SellerDispute[],
): SellerDispute | undefined {
  return disputes
    .filter(sellerNeedsToRespond)
    .toSorted(
      (left, right) =>
        Date.parse(left.deadline!.dueAt) - Date.parse(right.deadline!.dueAt),
    )[0];
}

export function sellerNeedsToRespond(dispute: SellerDispute): boolean {
  return (
    dispute.nextAction.actorKind === "SELLER" &&
    dispute.nextAction.code === "SUBMIT_FIRST_RESPONSE" &&
    dispute.deadline?.kind === "SELLER_FIRST_RESPONSE"
  );
}

export function formatOrderReference(orderId: string): string {
  return orderId
    .replaceAll("-", "")
    .slice(-6)
    .toUpperCase()
    .replace(/[0-9]/g, (digit) => "۰۱۲۳۴۵۶۷۸۹"[Number(digit)]!);
}

export function responseRecoveryMessage(code: string): string {
  const messages: Record<string, string> = {
    DEADLINE_PASSED:
      "مهلت پاسخ پایان یافته و پرونده برای بررسی سوو آماده است. نتیجه را از همین پرونده پیگیری کنید.",
    INVALID_TRANSITION:
      "وضعیت پرونده تغییر کرده است. پرونده را تازه کنید و قدم بعدی را ببینید.",
    IDEMPOTENCY_CONFLICT:
      "این تلاش با پاسخ دیگری ثبت شده است. وضعیت تازه پرونده در حال دریافت است.",
    IDEMPOTENCY_IN_PROGRESS:
      "همین پاسخ هنوز در حال ثبت است. کمی بعد پرونده را تازه کنید.",
    NOT_FOUND:
      "این پرونده دیگر در دسترس فروشگاه نیست. به فهرست پرونده‌های اختلاف برگردید.",
    FORBIDDEN: "این پرونده در دسترس فروشگاه نیست. به فهرست پرونده‌های اختلاف برگردید.",
  };
  return messages[code] ?? "پاسخ ثبت نشد. دوباره تلاش کنید.";
}
