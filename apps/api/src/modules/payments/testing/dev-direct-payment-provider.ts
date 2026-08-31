import { createHmac, timingSafeEqual } from "node:crypto";

import {
  providerCallbackInputContract,
  providerRefundCallbackInputContract,
} from "@sevo/contracts/payments/v1";

import type { DirectPaymentProvider, VerifiedProviderCallback } from "../public";
import { InvalidProviderCallbackError } from "../public";

export class DevDirectPaymentProvider implements DirectPaymentProvider {
  readonly providerKey = "DEV";

  constructor(private readonly signingSecret: string) {}

  async initiate(command: Parameters<DirectPaymentProvider["initiate"]>[0]) {
    return {
      providerReference: `dev-${command.attemptId}`,
      redirectUrl: `/v1/payment-providers/dev/pay/${command.attemptId}`,
    };
  }

  successCallback(input: {
    attemptId: string;
    orderId: string;
    amount: number;
    providerEventId: string;
  }) {
    return this.callback({ ...input, result: "CONFIRMED" });
  }

  callback(input: {
    attemptId: string;
    orderId: string;
    amount: number;
    providerEventId: string;
    result: "CONFIRMED" | "FAILED" | "PENDING";
  }) {
    const unsigned = input;
    return {
      ...unsigned,
      signature: this.#sign(unsigned),
    };
  }

  async verifyAndMapCallback(rawInput: unknown): Promise<VerifiedProviderCallback> {
    const parsed = providerCallbackInputContract.safeParse(rawInput);
    if (!parsed.success)
      throw new InvalidProviderCallbackError("Invalid provider callback");
    const expected = this.#sign({
      attemptId: parsed.data.attemptId,
      orderId: parsed.data.orderId,
      amount: parsed.data.amount,
      result: parsed.data.result,
      providerEventId: parsed.data.providerEventId,
    });
    if (!safeEqual(parsed.data.signature, expected)) {
      throw new InvalidProviderCallbackError("Invalid provider callback");
    }
    return {
      attemptId: parsed.data.attemptId,
      orderId: parsed.data.orderId,
      amount: parsed.data.amount,
      result: parsed.data.result,
      providerEventId: parsed.data.providerEventId,
      providerReference: `dev-${parsed.data.attemptId}`,
    };
  }

  async query(command: Parameters<DirectPaymentProvider["query"]>[0]) {
    const lastHex = command.attemptId.replaceAll("-", "").at(-1) ?? "0";
    const result = Number.parseInt(lastHex, 16) % 2 === 0 ? "CONFIRMED" : "FAILED";
    return {
      attemptId: command.attemptId,
      orderId: command.orderId,
      amount: command.amount.amount,
      result,
      providerEventId: `dev-query-${command.attemptId}`,
      providerReference: command.providerReference,
    } satisfies VerifiedProviderCallback;
  }

  refundCallback(input: {
    paymentAttemptId: string;
    orderId: string;
    amount: { amount: number; currency: "IRR" };
    result: "CONFIRMED" | "FAILED";
    evidenceReference: string;
    providerEventId: string;
  }) {
    return { ...input, signature: this.#signRefund(input) };
  }

  async verifyAndMapRefundResult(rawInput: unknown) {
    const parsed = providerRefundCallbackInputContract.safeParse(rawInput);
    if (!parsed.success) throw new InvalidProviderCallbackError();
    const { signature, ...unsigned } = parsed.data;
    if (!safeEqual(signature, this.#signRefund(unsigned))) {
      throw new InvalidProviderCallbackError();
    }
    return unsigned;
  }

  #sign(input: {
    attemptId: string;
    orderId: string;
    amount: number;
    result: "CONFIRMED" | "FAILED" | "PENDING";
    providerEventId: string;
  }) {
    return createHmac("sha256", this.signingSecret)
      .update(
        [
          input.attemptId,
          input.orderId,
          input.amount,
          input.result,
          input.providerEventId,
        ].join("."),
      )
      .digest("hex");
  }

  #signRefund(input: {
    paymentAttemptId: string;
    orderId: string;
    amount: { amount: number; currency: "IRR" };
    result: "CONFIRMED" | "FAILED";
    evidenceReference: string;
    providerEventId: string;
  }) {
    return createHmac("sha256", this.signingSecret)
      .update(
        [
          input.paymentAttemptId,
          input.orderId,
          input.amount.amount,
          input.amount.currency,
          input.result,
          input.evidenceReference,
          input.providerEventId,
        ].join("."),
      )
      .digest("hex");
  }
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer)
  );
}
