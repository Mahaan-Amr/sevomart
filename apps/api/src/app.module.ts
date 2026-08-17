import { DynamicModule, Module } from "@nestjs/common";
import type { RuntimeEnvironment } from "@sevo/config";

import { HealthController, RUNTIME_ENVIRONMENT } from "./health/health.controller";
import {
  IdentityAccessModule,
  type IdentityAccessModuleOptions,
} from "./modules/identity-access/identity-access.module";
import { DevOtpProvider } from "./modules/notifications/testing/dev-otp-provider";
import { MediaModule } from "./modules/media/media.module";
import { StoreModule } from "./modules/store/store.module";

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
      providers: [{ provide: RUNTIME_ENVIRONMENT, useValue: environment }],
      imports: [
        IdentityAccessModule.register(environment, {
          ...identityOptions,
          otpProvider,
        }),
        MediaModule.register(environment),
        StoreModule.register(environment),
      ],
    };
  }
}
