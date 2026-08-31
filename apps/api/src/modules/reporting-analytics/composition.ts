import { DynamicModule, Module } from "@nestjs/common";
import type { RuntimeEnvironment } from "@sevo/config";
import { identityIdContract, storeIdContract } from "@sevo/contracts/platform/v1";

import {
  IDENTITY_SESSION_READER,
  SELLER_ACCESS_READ,
  type IdentitySessionReader,
  type SellerAccessRead,
} from "../identity-access/public";
import { ReportingAnalyticsService } from "./application/reporting-analytics.service";
import { PostgresReportingAnalyticsRepository } from "./infrastructure/postgres-reporting-analytics.repository";
import type {
  ReportingAnalyticsOrderRead,
  ReportingAnalyticsRepository,
  ReportingAnalyticsStoreResolver,
} from "./public";
import { ReportingAnalyticsController } from "./reporting-analytics.controller";
import {
  REPORTING_ANALYTICS_ORDERS,
  REPORTING_ANALYTICS_REPOSITORY,
  REPORTING_ANALYTICS_SERVICE,
  REPORTING_ANALYTICS_STORE_RESOLVER,
} from "./reporting-analytics.tokens";

export type ReportingAnalyticsModuleOptions = {
  repository?: ReportingAnalyticsRepository;
  orders: ReportingAnalyticsOrderRead;
  resolveSellerStore(identityId: string): Promise<string | undefined>;
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
      async resolveStore(identityId) {
        const storeId = await options.resolveSellerStore(identityId);
        return storeId ? storeIdContract.parse(storeId) : undefined;
      },
    };
    return {
      module: ReportingAnalyticsModule,
      controllers: [ReportingAnalyticsController],
      providers: [
        { provide: REPORTING_ANALYTICS_REPOSITORY, useValue: repository },
        { provide: REPORTING_ANALYTICS_ORDERS, useValue: options.orders },
        { provide: REPORTING_ANALYTICS_STORE_RESOLVER, useValue: storeResolver },
        {
          provide: REPORTING_ANALYTICS_SERVICE,
          inject: [
            REPORTING_ANALYTICS_REPOSITORY,
            REPORTING_ANALYTICS_ORDERS,
            IDENTITY_SESSION_READER,
            SELLER_ACCESS_READ,
            REPORTING_ANALYTICS_STORE_RESOLVER,
          ],
          useFactory: (
            reportingRepository: ReportingAnalyticsRepository,
            orders: ReportingAnalyticsOrderRead,
            sessions: IdentitySessionReader,
            sellerAccess: SellerAccessRead,
            stores: ReportingAnalyticsStoreResolver,
          ) =>
            new ReportingAnalyticsService(
              reportingRepository,
              orders,
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
