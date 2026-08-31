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
      providerReference: scenarioReference(command.attemptId, "PENDING"),
      redirectUrl: `/v1/payment-providers/dev/pay/${command.attemptId}?scenario=success`,
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

  scenarioCallback(input: {
    attemptId: string;
    orderId: string;
    amount: number;
    providerEventId: string;
    scenario: "success" | "failure" | "pending";
  }) {
    const { scenario, ...callback } = input;
    return this.callback({
      ...callback,
      result: { success: "CONFIRMED", failure: "FAILED", pending: "PENDING" }[
        scenario
      ] as "CONFIRMED" | "FAILED" | "PENDING",
    });
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
      providerReference: scenarioReference(parsed.data.attemptId, parsed.data.result),
      acceptedProviderReferences: ["CONFIRMED", "FAILED", "PENDING"].map((result) =>
        scenarioReference(
          parsed.data.attemptId,
          result as "CONFIRMED" | "FAILED" | "PENDING",
        ),
      ),
    };
  }

  async query(command: Parameters<DirectPaymentProvider["query"]>[0]) {
    const result = resultFromScenarioReference(
      command.attemptId,
      command.providerReference,
    );
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

const scenarioNames = {
  CONFIRMED: "success",
  FAILED: "failure",
  PENDING: "pending",
} as const;

function scenarioReference(
  attemptId: string,
  result: "CONFIRMED" | "FAILED" | "PENDING",
) {
  return `dev-scenario-${scenarioNames[result]}-${attemptId}`;
}

function resultFromScenarioReference(attemptId: string, providerReference: string) {
  const scenarios = ["CONFIRMED", "FAILED", "PENDING"] as const;
  const result = scenarios.find(
    (candidate) => scenarioReference(attemptId, candidate) === providerReference,
  );
  if (!result) {
    throw new Error(
      "Dev payment reconciliation requires an explicit demo payment scenario",
    );
  }
  return result;
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer)
  );
}
