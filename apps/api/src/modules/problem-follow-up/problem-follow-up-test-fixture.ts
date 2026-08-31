import { randomUUID } from "node:crypto";

import {
  identityIdContract,
  orderIdContract,
  storeIdContract,
} from "@sevo/contracts/platform/v1";

import { PostgresProblemFollowUpRepository } from "./infrastructure/postgres-problem-follow-up.repository";

export async function seedUnderReviewDisputeFixture(
  databaseUrl: string,
  buyerText: string,
) {
  const values = {
    orderId: orderIdContract.parse(randomUUID()),
    buyerId: identityIdContract.parse(randomUUID()),
    sellerId: identityIdContract.parse(randomUUID()),
    storeId: storeIdContract.parse(randomUUID()),
  };
  const repository = new PostgresProblemFollowUpRepository(
    databaseUrl,
    {
      async authorizeSensitiveAction() {
        throw new Error("fixture does not use sensitive access");
      },
    },
    () => ({ kind: "opaque-platform-access-transaction" }),
  );
  try {
    const opened = await repository.open({
      actorId: values.buyerId,
      storeId: values.storeId,
      input: {
        orderId: values.orderId,
        category: "DAMAGED",
        description: buyerText,
        evidence: [{ evidenceId: randomUUID() as never, kind: "IMAGE" }],
      },
      openedAt: new Date(),
      sellerResponseDeadline: new Date(Date.now() + 24 * 60 * 60 * 1000),
      idempotencyKey: `e2e-open-${randomUUID()}`,
      requestHash: "a".repeat(64),
      correlationId: randomUUID(),
    });
    await repository.respond({
      disputeId: opened.disputeId,
      actorId: values.sellerId,
      storeId: values.storeId,
      input: { response: "پاسخ فروشنده برای بررسی پلتفرم ثبت شد.", evidence: [] },
      occurredAt: new Date(),
      idempotencyKey: `e2e-response-${randomUUID()}`,
      requestHash: "b".repeat(64),
      correlationId: randomUUID(),
    });
    return { ...values, id: opened.disputeId, buyerText };
  } finally {
    await repository.onModuleDestroy();
  }
}
