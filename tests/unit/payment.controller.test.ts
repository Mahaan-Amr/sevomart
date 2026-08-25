import { describe, expect, it, vi } from "vitest";

import { PaymentController } from "../../apps/api/src/modules/payments/payment.controller";
import {
  DirectPaymentIdempotencyConflictError,
  DirectPaymentOrderNotPayableError,
  type DirectPaymentService,
} from "../../apps/api/src/modules/payments/public";

const buyerId = "10000000-0000-4000-8000-000000000001";
const orderId = "60000000-0000-4000-8000-000000000006";

describe("PaymentController", () => {
  it.each([
    [DirectPaymentOrderNotPayableError, "ORDER_NOT_PAYABLE"],
    [DirectPaymentIdempotencyConflictError, "IDEMPOTENCY_CONFLICT"],
  ])("maps %p to an actionable 409 contract", async (ErrorType, code) => {
    const payments = {
      createAttempt: vi.fn().mockRejectedValue(new ErrorType()),
    } as unknown as DirectPaymentService;
    const sessions = {
      readActiveIdentitySession: vi.fn().mockResolvedValue({
        actor: { identityId: buyerId },
      }),
    };
    const controller = new PaymentController(payments, sessions as never);
    const response = { header: vi.fn() };

    const thrown = await controller
      .createAttempt(
        orderId,
        "pay-once",
        {
          id: "browser-request-123",
          headers: { cookie: "sevo_session=test-session" },
        } as never,
        response as never,
      )
      .catch((error: unknown) => error);

    const responseError = thrown as {
      getStatus(): number;
      getResponse(): unknown;
    };
    expect(responseError.getStatus()).toBe(409);
    expect(responseError.getResponse()).toMatchObject({ code });
  });
});
