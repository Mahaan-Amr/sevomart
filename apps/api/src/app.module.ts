import { DynamicModule, Module } from "@nestjs/common";
import type { RuntimeEnvironment } from "@sevo/config";

import { HealthController } from "./health/health.controller";
import {
  IdentityAccessModule,
  type IdentityAccessModuleOptions,
} from "./modules/identity-access/identity-access.module";
import { DevOtpProvider } from "./modules/notifications/testing/dev-otp-provider";

@Module({})
export class AppModule {
  static register(
    environment: RuntimeEnvironment,
    identityOptions: IdentityAccessModuleOptions = {},
  ): DynamicModule {
    const otpProvider =
      identityOptions.otpProvider ??
      (environment.OTP_PROVIDER === "dev" ? new DevOtpProvider() : undefined);
    return {
      module: AppModule,
      controllers: [HealthController],
      imports: [
        IdentityAccessModule.register(environment, {
          ...identityOptions,
          otpProvider,
        }),
      ],
    };
  }
}
