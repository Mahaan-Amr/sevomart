import { createHmac, timingSafeEqual } from "node:crypto";

import { providerCallbackInputContract } from "@sevo/contracts/payments/v1";

import type { DirectPaymentProvider, VerifiedProviderCallback } from "../public";
import { InvalidProviderCallbackError } from "../public";

export class DevDirectPaymentProvider implements DirectPaymentProvider {
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
    const unsigned = { ...input, result: "CONFIRMED" as const };
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

  #sign(input: {
    attemptId: string;
    orderId: string;
    amount: number;
    result: "CONFIRMED";
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
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer)
  );
}
