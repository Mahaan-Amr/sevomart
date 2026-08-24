import { z } from "zod";

const identifierContract = z.uuid().brand("SevoId");

export type SevoId = z.infer<typeof identifierContract>;
export const identityIdContract = identifierContract.brand("IdentityId");
export const storeIdContract = identifierContract.brand("StoreId");
export const productIdContract = identifierContract.brand("ProductId");
export const variantIdContract = identifierContract.brand("VariantId");
export const orderIdContract = identifierContract.brand("OrderId");
export const paymentAttemptIdContract = identifierContract.brand("PaymentAttemptId");
export type IdentityId = z.infer<typeof identityIdContract>;
export type StoreId = z.infer<typeof storeIdContract>;
export type ProductId = z.infer<typeof productIdContract>;
export type VariantId = z.infer<typeof variantIdContract>;

export const timestampV1Contract = z.iso.datetime({ offset: true });

export const moneyV1Contract = z
  .object({
    amount: z.int().nonnegative(),
    currency: z.literal("IRR"),
  })
  .strict();

export const errorEnvelopeV1Contract = z
  .object({
    version: z.literal(1),
    code: z.string().min(1),
    message: z.string().min(1),
    correlationId: z.uuid(),
  })
  .strict();

export const eventActorV1Contract = z.discriminatedUnion("type", [
  z.object({ type: z.literal("IDENTITY"), id: identityIdContract }).strict(),
  z.object({ type: z.literal("SYSTEM") }).strict(),
]);

export const eventEnvelopeV1Contract = z
  .object({
    version: z.literal(1),
    eventId: z.uuid(),
    eventType: z.string().min(1),
    aggregateId: z.uuid(),
    aggregateVersion: z.int().positive(),
    occurredAt: timestampV1Contract,
    correlationId: z.uuid(),
    causationId: z.uuid().optional(),
    actor: eventActorV1Contract.optional(),
  })
  .strict();

export type TimestampV1 = z.infer<typeof timestampV1Contract>;
export type MoneyV1 = z.infer<typeof moneyV1Contract>;
export type ErrorEnvelopeV1 = z.infer<typeof errorEnvelopeV1Contract>;
export type EventActorV1 = z.infer<typeof eventActorV1Contract>;
export type EventEnvelopeV1 = z.infer<typeof eventEnvelopeV1Contract>;
