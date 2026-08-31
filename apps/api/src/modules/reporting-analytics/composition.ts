import { DynamicModule, Module } from "@nestjs/common";
import type { RuntimeEnvironment } from "@sevo/config";
import {
  identityIdContract,
  type IdentityId,
  type StoreId,
} from "@sevo/contracts/platform/v1";

import {
  IDENTITY_SESSION_READER,
  SELLER_ACCESS_READ,
  type IdentitySessionReader,
  type SellerAccessRead,
} from "../identity-access/public";
import { ReportingAnalyticsService } from "./application/reporting-analytics.service";
import { PostgresReportingAnalyticsRepository } from "./infrastructure/postgres-reporting-analytics.repository";
import type {
  ReportingAnalyticsRepository,
  ReportingAnalyticsStoreResolver,
} from "./public";
import { ReportingAnalyticsController } from "./reporting-analytics.controller";
import {
  REPORTING_ANALYTICS_REPOSITORY,
  REPORTING_ANALYTICS_SERVICE,
  REPORTING_ANALYTICS_STORE_RESOLVER,
} from "./reporting-analytics.tokens";

export type ReportingAnalyticsModuleOptions = {
  repository?: ReportingAnalyticsRepository;
  resolveSellerStore(identityId: IdentityId): Promise<StoreId | undefined>;
};

@Module({})
export class ReportingAnalyticsModule {
  static register(
    environment: RuntimeEnvironment,
    options: ReportingAnalyticsModuleOptions,
  ): DynamicModule {
    const repository =
      options.repository ??
      new PostgresReportingAnalyticsRepository(environment.DATABASE_URL);
    const storeResolver: ReportingAnalyticsStoreResolver = {
      resolveStore: options.resolveSellerStore,
    };
    return {
      module: ReportingAnalyticsModule,
      controllers: [ReportingAnalyticsController],
      providers: [
        { provide: REPORTING_ANALYTICS_REPOSITORY, useValue: repository },
        { provide: REPORTING_ANALYTICS_STORE_RESOLVER, useValue: storeResolver },
        {
          provide: REPORTING_ANALYTICS_SERVICE,
          inject: [
            REPORTING_ANALYTICS_REPOSITORY,
            IDENTITY_SESSION_READER,
            SELLER_ACCESS_READ,
            REPORTING_ANALYTICS_STORE_RESOLVER,
          ],
          useFactory: (
            reportingRepository: ReportingAnalyticsRepository,
            sessions: IdentitySessionReader,
            sellerAccess: SellerAccessRead,
            stores: ReportingAnalyticsStoreResolver,
          ) =>
            new ReportingAnalyticsService(
              reportingRepository,
              {
                async readActiveIdentitySession(token) {
                  const session = await sessions.readActiveIdentitySession(token);
                  return session
                    ? {
                        identityId: identityIdContract.parse(session.actor.identityId),
                      }
                    : undefined;
                },
              },
              sellerAccess,
              stores,
            ),
        },
      ],
    };
  }
}

export { PostgresReportingAnalyticsRepository };
