import { DynamicModule, Module } from "@nestjs/common";
import type { RuntimeEnvironment } from "@sevo/config";
import type { OtpCode } from "@sevo/contracts/identity-access/v1";
import type { Sql } from "postgres";

import {
  createProductionOtpCode,
  IdentityOtpService,
} from "./application/identity-otp.service";
import { IdentityAccessController } from "./identity-access.controller";
import {
  IDENTITY_ACCESS_REPOSITORY,
  OTP_PROVIDER,
  RUNTIME_ENVIRONMENT,
  IDENTITY_OTP_SERVICE,
  SELLER_APPLICATION_APPLICANT,
  SELLER_APPLICATION_REPOSITORY,
  SELLER_APPLICATION_REVIEWER,
  SELLER_APPROVAL_RECOVERY,
  PLATFORM_AGENT_SESSION_AUTHORIZER,
  PLATFORM_AGENT_OTP_SERVICE,
  PLATFORM_ACCESS_CORE,
} from "./identity-access.tokens";
import { PostgresIdentityAccessRepository } from "./infrastructure/postgres-identity-access.repository";
import { PostgresPlatformAgentSessionAuthorizer } from "./infrastructure/postgres-platform-agent-session-authorizer";
import { PostgresSellerApplicationRepository } from "./infrastructure/postgres-seller-application.repository";
import {
  IDENTITY_SESSION_READER,
  SELLER_ACCESS_READ,
  type IdentityAccessRepository,
  type OtpProvider,
  type PlatformAgentSessionAuthorizer,
} from "./public";
import { SellerApplicationController } from "./seller-application.controller";
import { PlatformSellerApplicationController } from "./platform-seller-application.controller";
import { PlatformAgentAuthController } from "./platform-agent-auth.controller";
import { PlatformAgentOtpService } from "./application/platform-agent-otp.service";
import { SellerApprovalRecoveryController } from "./seller-approval-recovery.controller";
import { PlatformAccessController } from "./platform-access.controller";
import { PostgresPlatformAccessRepository } from "./infrastructure/postgres-platform-access.repository";
import type {
  ApprovedSellerStoreProvisioner,
  OpaqueStoreTransactionContext,
} from "../store/public";

export type IdentityAccessModuleOptions = {
  otpProvider?: OtpProvider;
  repository?: IdentityAccessRepository;
  approvedSellerStoreProvisioner?: ApprovedSellerStoreProvisioner;
  createStoreTransactionContext?: (transaction: Sql) => OpaqueStoreTransactionContext;
  platformAgentSessionAuthorizer?: PlatformAgentSessionAuthorizer;
};

@Module({})
export class IdentityAccessModule {
  static register(
    environment: RuntimeEnvironment,
    options: IdentityAccessModuleOptions = {},
  ): DynamicModule {
    const otpProvider = options.otpProvider;
    if (!otpProvider) {
      throw new Error("The selected OTP provider is not configured");
    }

    return {
      module: IdentityAccessModule,
      global: true,
      controllers: [
        IdentityAccessController,
        SellerApplicationController,
        PlatformSellerApplicationController,
        PlatformAgentAuthController,
        SellerApprovalRecoveryController,
        PlatformAccessController,
      ],
      providers: [
        { provide: RUNTIME_ENVIRONMENT, useValue: environment },
        { provide: OTP_PROVIDER, useValue: otpProvider },
        {
          provide: PLATFORM_AGENT_OTP_SERVICE,
          useValue: new PlatformAgentOtpService(
            environment.DATABASE_URL,
            otpProvider,
            environment.SEVO_RUNTIME_ENV === "production"
              ? createProductionOtpCode
              : () => "111111" as OtpCode,
          ),
        },
        {
          provide: IDENTITY_ACCESS_REPOSITORY,
          useValue:
            options.repository ??
            new PostgresIdentityAccessRepository(environment.DATABASE_URL),
        },
        {
          provide: IDENTITY_OTP_SERVICE,
          inject: [OTP_PROVIDER, IDENTITY_ACCESS_REPOSITORY],
          useFactory: (provider: OtpProvider, repository: IdentityAccessRepository) =>
            new IdentityOtpService(
              provider,
              repository,
              environment.SEVO_RUNTIME_ENV === "production"
                ? undefined
                : environment.DEV_OTP_TEST_MOBILES,
              undefined,
              environment.SEVO_RUNTIME_ENV === "production"
                ? createProductionOtpCode
                : undefined,
            ),
        },
        { provide: IDENTITY_SESSION_READER, useExisting: IDENTITY_OTP_SERVICE },
        { provide: SELLER_ACCESS_READ, useExisting: IDENTITY_ACCESS_REPOSITORY },
        {
          provide: SELLER_APPLICATION_REPOSITORY,
          useValue: new PostgresSellerApplicationRepository(
            environment.DATABASE_URL,
            options.approvedSellerStoreProvisioner,
            options.createStoreTransactionContext,
          ),
        },
        {
          provide: SELLER_APPLICATION_APPLICANT,
          useExisting: SELLER_APPLICATION_REPOSITORY,
        },
        {
          provide: SELLER_APPLICATION_REVIEWER,
          useExisting: SELLER_APPLICATION_REPOSITORY,
        },
        {
          provide: SELLER_APPROVAL_RECOVERY,
          useExisting: SELLER_APPLICATION_REPOSITORY,
        },
        {
          provide: PLATFORM_AGENT_SESSION_AUTHORIZER,
          useValue:
            options.platformAgentSessionAuthorizer ??
            new PostgresPlatformAgentSessionAuthorizer(environment.DATABASE_URL),
        },
        {
          provide: PLATFORM_ACCESS_CORE,
          useValue: new PostgresPlatformAccessRepository(environment.DATABASE_URL),
        },
      ],
      exports: [IDENTITY_SESSION_READER, SELLER_ACCESS_READ],
    };
  }
}
