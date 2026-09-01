import { describe, expect, it } from "vitest";

import { presentBuyerOrderState } from "./buyer-order-presentation";

describe("buyer order state presentation", () => {
  it("does not promise a refund while verification is pending", () => {
    expect(presentBuyerOrderState("CANCELLATION_PENDING_REFUND", "PENDING")).toEqual({
      label: "بازپرداخت در حال بررسی",
      nextStep: "نتیجه بازپرداخت را همین‌جا پیگیری کنید.",
    });
  });

  it("makes the next payment action explicit", () => {
    expect(presentBuyerOrderState("PENDING_PAYMENT")).toEqual({
      label: "در انتظار پرداخت",
      nextStep: "برای حفظ رزرو، پرداخت را تا پایان مهلت سفارش انجام دهید.",
    });
  });

  it("describes confirmed refunds without a platform guarantee", () => {
    expect(presentBuyerOrderState("CANCELLED", "CONFIRMED")).toEqual({
      label: "سفارش لغو و بازپرداخت تأیید شد",
      nextStep: "ثبت نتیجه درگاه انجام شده است؛ رسید بانکی خود را نیز نگه دارید.",
    });
  });
});
