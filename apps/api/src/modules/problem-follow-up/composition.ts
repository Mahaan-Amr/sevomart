import { type DynamicModule, Module } from "@nestjs/common";
import type { RuntimeEnvironment } from "@sevo/config";
import { disputeIdContract } from "@sevo/contracts/problem-follow-up/v1";
import { identityIdContract, storeIdContract } from "@sevo/contracts/platform/v1";
import type { Sql } from "postgres";

import {
  IDENTITY_SESSION_READER,
  PLATFORM_SENSITIVE_ACCESS,
  SELLER_ACCESS_READ,
  type IdentitySessionReader,
  type OpaquePlatformAccessTransactionContext,
  type PlatformAgentSessionAuthorizer,
  type PlatformSensitiveAccess,
  type SellerAccessRead,
} from "../identity-access/public";
import {
  DISPUTE_EVIDENCE_READER,
  type DisputeEvidenceReader,
  type DisputeMediaAccess,
} from "../media/public";
import { ProblemFollowUpService } from "./application/problem-follow-up.service";
import { PostgresProblemFollowUpRepository } from "./infrastructure/postgres-problem-follow-up.repository";
import { ProblemFollowUpController } from "./problem-follow-up.controller";
import {
  PROBLEM_FOLLOW_UP_SERVICE,
  type ProblemFollowUpFulfillmentRead,
  type ProblemFollowUpRepository,
} from "./public";

@Module({})
export class ProblemFollowUpModule {
  static register(
    environment: RuntimeEnvironment,
    options: {
      fulfillment: ProblemFollowUpFulfillmentRead;
      platformSessions: PlatformAgentSessionAuthorizer;
      resolveSellerStore: (identityId: string) => Promise<string | undefined>;
      createAccessTransactionContext: (
        transaction: Sql,
      ) => OpaquePlatformAccessTransactionContext;
      repository?: ProblemFollowUpRepository;
      onMediaAccessReady?: (access: DisputeMediaAccess) => void;
    },
  ): DynamicModule {
    return {
      module: ProblemFollowUpModule,
      controllers: [ProblemFollowUpController],
      providers: [
        {
          provide: PROBLEM_FOLLOW_UP_SERVICE,
          inject: [
            IDENTITY_SESSION_READER,
            SELLER_ACCESS_READ,
            PLATFORM_SENSITIVE_ACCESS,
            DISPUTE_EVIDENCE_READER,
          ],
          useFactory: (
            sessions: IdentitySessionReader,
            sellerAccess: SellerAccessRead,
            sensitiveAccess: PlatformSensitiveAccess,
            evidence: DisputeEvidenceReader,
          ) => {
            const repository =
              options.repository ??
              new PostgresProblemFollowUpRepository(
                environment.DATABASE_URL,
                sensitiveAccess,
                options.createAccessTransactionContext,
              );
            options.onMediaAccessReady?.(async ({ identityId, disputeId }) => {
              const parsedIdentityId = identityIdContract.parse(identityId);
              if (!(await sellerAccess.isActiveSeller(parsedIdentityId))) return false;
              const rawStoreId = await options.resolveSellerStore(parsedIdentityId);
              if (!rawStoreId) return false;
              try {
                await repository.readSeller(
                  storeIdContract.parse(rawStoreId),
                  disputeIdContract.parse(disputeId),
                );
                return true;
              } catch {
                return false;
              }
            });
            return new ProblemFollowUpService(
              repository,
              {
                async readActiveIdentitySession(token) {
                  const session = await sessions.readActiveIdentitySession(token);
                  return session
                    ? { identityId: identityIdContract.parse(session.actor.identityId) }
                    : undefined;
                },
              },
              options.fulfillment,
              () => new Date(),
              sellerAccess,
              {
                async resolveStore(identityId) {
                  const storeId = await options.resolveSellerStore(identityId);
                  return storeId ? storeIdContract.parse(storeId) : undefined;
                },
              },
              options.platformSessions,
              evidence,
            );
          },
        },
      ],
    };
  }
}

export { PostgresProblemFollowUpRepository };
