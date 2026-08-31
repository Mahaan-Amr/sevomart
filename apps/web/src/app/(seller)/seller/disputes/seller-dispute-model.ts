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
    .filter(
      (dispute) =>
        dispute.nextAction.actorKind === "SELLER" &&
        dispute.nextAction.code === "SUBMIT_FIRST_RESPONSE" &&
        dispute.deadline?.kind === "SELLER_FIRST_RESPONSE",
    )
    .toSorted(
      (left, right) =>
        Date.parse(left.deadline!.dueAt) - Date.parse(right.deadline!.dueAt),
    )[0];
}

export function responseRecoveryMessage(code: string): string {
  const messages: Record<string, string> = {
    DEADLINE_PASSED:
      "مهلت پاسخ گذشته است. پرونده را تازه کنید تا وضعیت و قدم بعدی را ببینید.",
    INVALID_TRANSITION:
      "وضعیت پرونده تغییر کرده است. پرونده را تازه کنید و قدم بعدی را ببینید.",
    IDEMPOTENCY_CONFLICT:
      "این تلاش با پاسخ دیگری ثبت شده است. پرونده را تازه کنید و نتیجه را بررسی کنید.",
    IDEMPOTENCY_IN_PROGRESS:
      "همین پاسخ هنوز در حال ثبت است. کمی بعد پرونده را تازه کنید.",
    NOT_FOUND: "این پرونده دیگر در دسترس فروشگاه نیست. به فهرست اختلاف‌ها برگردید.",
    FORBIDDEN: "این پرونده در دسترس فروشگاه نیست. به فهرست اختلاف‌ها برگردید.",
  };
  return messages[code] ?? "پاسخ ثبت نشد. دوباره تلاش کنید.";
}
