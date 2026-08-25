import { z } from "zod";

import { createJsonSchemaMap } from "../../json-schema";
import {
  eventActorV1Contract,
  eventEnvelopeV1Contract,
  moneyV1Contract,
  orderIdContract,
  paymentAttemptIdContract,
} from "../../platform/v1/index";

export const createDirectPaymentAttemptInputContract = z.object({}).strict();
export const paymentIdempotencyKeyContract = z.string().min(1).max(200);

export const directPaymentAttemptStatusContract = z.enum([
  "CREATED",
  "DISPATCHED",
  "CONFIRMED",
  "FAILED",
  "REVIEW_REQUIRED",
]);

export const directPaymentAttemptContract = z
  .object({
    attemptId: paymentAttemptIdContract,
    orderId: orderIdContract,
    status: directPaymentAttemptStatusContract,
    amount: moneyV1Contract,
    provider: z.string().min(1).max(24),
    redirectUrl: z.string().min(1).max(500).optional(),
    providerReference: z.string().min(1).max(128).optional(),
    createdAt: z.iso.datetime({ offset: true }),
    confirmedAt: z.iso.datetime({ offset: true }).optional(),
  })
  .strict();

export const providerCallbackInputContract = z
  .object({
    attemptId: paymentAttemptIdContract,
    orderId: orderIdContract,
    amount: z.int().nonnegative(),
    result: z.enum(["CONFIRMED", "FAILED", "PENDING"]),
    providerEventId: z.string().min(1).max(128),
    signature: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

export const providerCallbackResultContract = z
  .object({
    attemptId: paymentAttemptIdContract,
    status: z.literal("CONFIRMED"),
    duplicate: z.boolean(),
  })
  .strict();

export const directPaymentAttemptConfirmedV1Contract = eventEnvelopeV1Contract.extend({
  eventType: z.literal("DirectPaymentAttemptConfirmed.v1"),
  causationId: z.uuid(),
  actor: eventActorV1Contract,
  payload: z
    .object({
      status: z.literal("CONFIRMED"),
      amount: moneyV1Contract,
    })
    .strict(),
});

export const directPaymentAttemptCreatedV1Contract = eventEnvelopeV1Contract.extend({
  eventType: z.literal("DirectPaymentAttemptCreated.v1"),
  causationId: z.uuid(),
  actor: eventActorV1Contract,
  payload: z.object({ status: z.literal("CREATED"), amount: moneyV1Contract }).strict(),
});

export const directPaymentAttemptDispatchedV1Contract = eventEnvelopeV1Contract.extend({
  eventType: z.literal("DirectPaymentAttemptDispatched.v1"),
  causationId: z.uuid(),
  actor: z.object({ type: z.literal("SYSTEM") }).strict(),
  payload: z.object({ status: z.literal("DISPATCHED") }).strict(),
});

export const directPaymentAttemptReviewRequiredV1Contract =
  eventEnvelopeV1Contract.extend({
    eventType: z.literal("DirectPaymentAttemptReviewRequired.v1"),
    causationId: z.uuid(),
    actor: z.object({ type: z.literal("SYSTEM") }).strict(),
    payload: z.object({ status: z.literal("REVIEW_REQUIRED") }).strict(),
  });

export const paymentsV1Schemas = {
  OrderId: orderIdContract,
  PaymentAttemptId: paymentAttemptIdContract,
  IdempotencyKey: paymentIdempotencyKeyContract,
  PaymentProviderKey: z.string().min(1).max(24),
  CreateDirectPaymentAttemptInput: createDirectPaymentAttemptInputContract,
  DirectPaymentAttempt: directPaymentAttemptContract,
  ProviderCallbackInput: providerCallbackInputContract,
  ProviderCallbackResult: providerCallbackResultContract,
} as const;

export function createPaymentsV1JsonSchemas() {
  return createJsonSchemaMap(paymentsV1Schemas);
}

export const paymentsV1Examples = {
  CreateDirectPaymentAttemptInput: {},
  DirectPaymentAttempt: {
    attemptId: "91fe87eb-6c0f-47ca-93ca-9f9a038ca273",
    orderId: "47a3f408-858c-45d7-a0bd-ab84a28718ef",
    status: "DISPATCHED",
    amount: { amount: 4_500_000, currency: "IRR" },
    provider: "DEV",
    redirectUrl: "/v1/payment-providers/dev/pay/91fe87eb-6c0f-47ca-93ca-9f9a038ca273",
    createdAt: "2026-08-25T08:00:00.000Z",
  },
  ProviderCallbackInput: {
    attemptId: "91fe87eb-6c0f-47ca-93ca-9f9a038ca273",
    orderId: "47a3f408-858c-45d7-a0bd-ab84a28718ef",
    amount: 4_500_000,
    result: "CONFIRMED",
    providerEventId: "dev-event-1",
    signature: "a".repeat(64),
  },
  ProviderCallbackResult: {
    attemptId: "91fe87eb-6c0f-47ca-93ca-9f9a038ca273",
    status: "CONFIRMED",
    duplicate: false,
  },
} as const;

export type DirectPaymentAttempt = z.infer<typeof directPaymentAttemptContract>;
export type ProviderCallbackInput = z.infer<typeof providerCallbackInputContract>;
export type ProviderCallbackResult = z.infer<typeof providerCallbackResultContract>;
