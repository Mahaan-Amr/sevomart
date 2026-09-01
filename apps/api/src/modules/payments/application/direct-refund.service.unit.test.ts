import type { DirectRefund } from "@sevo/contracts/payments/v1";
import {
  paymentAttemptIdContract,
  type IdentityId,
  type OrderId,
  type StoreId,
} from "@sevo/contracts/platform/v1";
import { describe, expect, it } from "vitest";

import {
  DirectRefundFault,
  type DirectRefundRepository,
  type DirectRefundSellerAccess,
  type DirectRefundSessionRead,
  type DirectRefundStoreResolver,
  type DirectPaymentProvider,
} from "../public";
import { DirectRefundApplicationService } from "./direct-refund.service";

const actorId = "57a3f408-858c-45d7-a0bd-ab84a28718ef" as IdentityId;
const storeId = "77a3f408-858c-45d7-a0bd-ab84a28718ef" as StoreId;
const orderId = "47a3f408-858c-45d7-a0bd-ab84a28718ef" as OrderId;
const correlationId = "87a3f408-858c-45d7-a0bd-ab84a28718ef";
const paymentAttemptId = paymentAttemptIdContract.parse(
  "91fe87eb-6c0f-47ca-93ca-9f9a038ca273",
);

function harness() {
  let refund: DirectRefund | undefined;
  const repository: DirectRefundRepository = {
    async request(command) {
      refund = {
        orderId: command.orderId,
        paymentAttemptId,
        amount: { amount: 12_500_000, currency: "IRR" },
        status: "PENDING",
        orderStatus: "CANCELLATION_PENDING_REFUND",
        nextAction: "WAIT_FOR_VERIFICATION",
        updatedAt: command.occurredAt.toISOString(),
      };
      return refund!;
    },
    async readForSeller(requestedStoreId, requestedOrderId) {
      return requestedStoreId === storeId && requestedOrderId === orderId
        ? refund
        : undefined;
    },
    async recordResult(command) {
      refund = {
        orderId: command.orderId,
        paymentAttemptId: command.input.paymentAttemptId,
        amount: command.input.amount,
        status: command.input.result,
        orderStatus:
          command.input.result === "CONFIRMED"
            ? "CANCELLED"
            : "CANCELLATION_PENDING_REFUND",
        nextAction: command.input.result === "CONFIRMED" ? "NONE" : "RETRY_REFUND",
        updatedAt: command.occurredAt.toISOString(),
      };
      return refund!;
    },
  };
  const sessions: DirectRefundSessionRead = {
    async readActiveIdentitySession(token) {
      return token === "seller" ? { identityId: actorId } : undefined;
    },
  };
  const sellerAccess: DirectRefundSellerAccess = {
    async isActiveSeller(identityId) {
      return identityId === actorId;
    },
  };
  const stores: DirectRefundStoreResolver = {
    async resolveStore(identityId) {
      return identityId === actorId ? storeId : undefined;
    },
  };
  const provider: DirectPaymentProvider = {
    providerKey: "DEV",
    async initiate() {
      throw new Error("unused");
    },
    async verifyAndMapCallback() {
      throw new Error("unused");
    },
    async query() {
      throw new Error("unused");
    },
    async verifyAndMapRefundResult(input) {
      if (!input || typeof input !== "object" || !("verified" in input)) {
        throw new Error("unverified");
      }
      const value = input as unknown as {
        paymentAttemptId: typeof paymentAttemptId;
        orderId: OrderId;
        amount: { amount: number; currency: "IRR" };
        result: "CONFIRMED" | "FAILED";
        evidenceReference: string;
        providerEventId: string;
      };
      return value;
    },
  };
  return new DirectRefundApplicationService(
    repository,
    sessions,
    sellerAccess,
    stores,
    provider,
    () => new Date("2026-08-31T08:00:00.000Z"),
  );
}

describe("DirectRefundApplicationService", () => {
  it("accepts only verified provider results before final cancellation", async () => {
    const service = harness();
    const request = { sessionToken: "seller", correlationId };
    await expect(
      service.request(
        request,
        orderId,
        { reason: "کالا پیش از ارسال قابل تأمین نیست." },
        "refund-request-135",
      ),
    ).resolves.toMatchObject({
      status: "PENDING",
      orderStatus: "CANCELLATION_PENDING_REFUND",
    });
    await expect(
      service.applyProviderResult(
        "DEV",
        {
          paymentAttemptId,
          orderId,
          amount: { amount: 12_500_000, currency: "IRR" },
          result: "FAILED",
          evidenceReference: "provider-result-135-1",
        },
        "refund-failed-135",
        correlationId,
      ),
    ).rejects.toMatchObject({ code: "REFUND_EVIDENCE_REQUIRED" });
    const verified = (result: "CONFIRMED" | "FAILED", suffix: string) => ({
      verified: true,
      paymentAttemptId,
      orderId,
      amount: { amount: 12_500_000, currency: "IRR" as const },
      result,
      evidenceReference: `provider-result-135-${suffix}`,
      providerEventId: `refund-provider-event-135-${suffix}`,
    });
    await expect(
      service.applyProviderResult(
        "DEV",
        verified("FAILED", "1"),
        "refund-failed-135",
        correlationId,
      ),
    ).resolves.toMatchObject({
      status: "FAILED",
      orderStatus: "CANCELLATION_PENDING_REFUND",
      nextAction: "RETRY_REFUND",
    });
    await expect(
      service.applyProviderResult(
        "DEV",
        verified("CONFIRMED", "2"),
        "refund-confirmed-135",
        correlationId,
      ),
    ).resolves.toMatchObject({
      status: "CONFIRMED",
      orderStatus: "CANCELLED",
      nextAction: "NONE",
    });
  });

  it("requires an active seller session, valid body, and idempotency key", async () => {
    const service = harness();
    await expect(
      service.request(
        { correlationId },
        orderId,
        { reason: "کالا پیش از ارسال قابل تأمین نیست." },
        "refund-request-135",
      ),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    await expect(
      service.request(
        { sessionToken: "seller", correlationId },
        orderId,
        { reason: "کوتاه" },
        "refund-request-135",
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(
      service.request(
        { sessionToken: "seller", correlationId },
        orderId,
        { reason: "کالا پیش از ارسال قابل تأمین نیست." },
        undefined,
      ),
    ).rejects.toBeInstanceOf(DirectRefundFault);
  });
});
