import { DynamicModule, Module } from "@nestjs/common";
import type { RuntimeEnvironment } from "@sevo/config";

import { HealthController, RUNTIME_READINESS } from "./health/health.controller";
import { createRuntimeReadinessCheck } from "./health/runtime-readiness";
import {
  IdentityAccessModule,
  type IdentityAccessModuleOptions,
} from "./modules/identity-access/identity-access.module";
import { DevOtpProvider } from "./modules/notifications/testing/dev-otp-provider";
import { MediaModule } from "./modules/media/media.module";
import { PostgresStoreRepository } from "./modules/store/infrastructure/postgres-store.repository";
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
    const storeRepository = new PostgresStoreRepository(environment.DATABASE_URL);
    return {
      module: AppModule,
      controllers: [HealthController],
      providers: [
        {
          provide: RUNTIME_READINESS,
          useValue: createRuntimeReadinessCheck(environment),
        },
      ],
      imports: [
        IdentityAccessModule.register(environment, {
          ...identityOptions,
          otpProvider,
        }),
        MediaModule.register(environment, undefined, (mediaId) =>
          storeRepository.isMediaPublished(mediaId),
        ),
        StoreModule.register(environment, { repository: storeRepository }),
      ],
    };
  }
}
