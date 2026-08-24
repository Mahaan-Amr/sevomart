import { randomUUID } from "node:crypto";

import postgres from "postgres";
import { beforeEach, describe, expect, it } from "vitest";

import { PostgresSellerApplicationRepository } from "../../apps/api/src/modules/identity-access/composition";
import {
  SellerApplicationIdempotencyInProgressError,
  type SellerApplicationApplicant,
} from "../../apps/api/src/modules/identity-access/public";
import { apiTestEnvironment } from "../helpers/api-test-environment";

describe("seller application applicant interface with PostgreSQL", () => {
  beforeEach(async () => {
    const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
    await sql`delete from identity_seller_access`;
    await sql`delete from identity_seller_application_idempotency`;
    await sql`delete from identity_seller_application_audit`;
    await sql`delete from identity_seller_application_decisions`;
    await sql`delete from identity_seller_application_revisions`;
    await sql`delete from identity_seller_applications`;
    await sql`delete from platform_outbox_events where event_type like 'SellerApplication%'`;
    await sql.end();
  });

  it("serves the applicant module directly with cursor pagination and withdrawal", async () => {
    const implementation = new PostgresSellerApplicationRepository(
      apiTestEnvironment.DATABASE_URL,
    );
    const applicant: SellerApplicationApplicant = implementation;
    const identityId = randomUUID();
    const applicationIds: string[] = [];

    try {
      for (let index = 0; index < 3; index += 1) {
        const submitted = await applicant.submit(
          command(identityId),
          applicationPayload(`خانه ماه ${index}`),
        );
        applicationIds.push(submitted.applicationId);
        const withdrawn = await applicant.withdraw(
          command(identityId),
          submitted.applicationId,
          { expectedRevision: submitted.currentRevision },
        );
        expect(withdrawn).toMatchObject({
          status: "WITHDRAWN",
          nextStep: "APPLICATION_ENDED",
        });
      }

      const firstPage = await applicant.readMine(identityId, { limit: 2 });
      expect(firstPage.items).toHaveLength(2);
      expect(firstPage.nextCursor).not.toBeNull();
      const secondPage = await applicant.readMine(identityId, {
        cursor: firstPage.nextCursor!,
        limit: 2,
      });
      expect(secondPage.items).toHaveLength(1);
      expect(secondPage.nextCursor).toBeNull();
      expect(
        new Set(
          [...firstPage.items, ...secondPage.items].map((item) => item.applicationId),
        ),
      ).toEqual(new Set(applicationIds));
    } finally {
      await implementation.onModuleDestroy();
    }
  });

  it("reports an in-progress duplicate when the command lock is already held", async () => {
    const implementation = new PostgresSellerApplicationRepository(
      apiTestEnvironment.DATABASE_URL,
    );
    const identityId = randomUUID();
    const context = command(identityId);
    const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
    const lockKey = `SubmitSellerApplication.v1:${identityId}:${context.idempotencyKey}`;

    try {
      await sql.begin(async (transaction) => {
        await transaction`
          select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))
        `;
        await expect(
          implementation.submit(context, applicationPayload("خانه هم‌زمان")),
        ).rejects.toBeInstanceOf(SellerApplicationIdempotencyInProgressError);
      });
    } finally {
      await sql.end();
      await implementation.onModuleDestroy();
    }
  });

  it("replays semantically identical payloads regardless of property order", async () => {
    const implementation = new PostgresSellerApplicationRepository(
      apiTestEnvironment.DATABASE_URL,
    );
    const context = command(randomUUID());
    const payload = applicationPayload("خانه canonical");
    const reordered = Object.fromEntries(
      Object.entries(payload).reverse(),
    ) as typeof payload;

    try {
      const submitted = await implementation.submit(context, payload);
      await expect(implementation.submit(context, reordered)).resolves.toEqual(
        submitted,
      );
    } finally {
      await implementation.onModuleDestroy();
    }
  });
});

function command(identityId: string) {
  return {
    identityId,
    correlationId: randomUUID(),
    idempotencyKey: randomUUID(),
  };
}

function applicationPayload(proposedStoreName: string) {
  return {
    applicantName: "نگار محمدی",
    proposedStoreName,
    goodsAreaText: "سفال دست‌ساز",
    currentSalesMethod: "فروش از راه اینستاگرام و پیام مستقیم",
  };
}
