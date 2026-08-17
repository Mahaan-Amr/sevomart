import { DynamicModule, Module } from "@nestjs/common";
import type { RuntimeEnvironment } from "@sevo/config";

import {
  createProductionOtpCode,
  SellerOtpService,
} from "./application/seller-otp.service";
import { IdentityAccessController } from "./identity-access.controller";
import {
  IDENTITY_ACCESS_REPOSITORY,
  OTP_PROVIDER,
  RUNTIME_ENVIRONMENT,
  SELLER_OTP_SERVICE,
} from "./identity-access.tokens";
import { PostgresIdentityAccessRepository } from "./infrastructure/postgres-identity-access.repository";
import {
  SELLER_SESSION_READER,
  type IdentityAccessRepository,
  type OtpProvider,
} from "./public";

export type IdentityAccessModuleOptions = {
  otpProvider?: OtpProvider;
  repository?: IdentityAccessRepository;
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
      controllers: [IdentityAccessController],
      providers: [
        { provide: RUNTIME_ENVIRONMENT, useValue: environment },
        { provide: OTP_PROVIDER, useValue: otpProvider },
        {
          provide: IDENTITY_ACCESS_REPOSITORY,
          useValue:
            options.repository ??
            new PostgresIdentityAccessRepository(environment.DATABASE_URL),
        },
        {
          provide: SELLER_OTP_SERVICE,
          inject: [OTP_PROVIDER, IDENTITY_ACCESS_REPOSITORY],
          useFactory: (provider: OtpProvider, repository: IdentityAccessRepository) =>
            new SellerOtpService(
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
        { provide: SELLER_SESSION_READER, useExisting: SELLER_OTP_SERVICE },
      ],
      exports: [SELLER_SESSION_READER],
    };
  }
}
