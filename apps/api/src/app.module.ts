import { DynamicModule, Module } from "@nestjs/common";
import type { RuntimeEnvironment } from "@sevo/config";

import { HealthController } from "./health/health.controller";
import {
  IdentityAccessModule,
  type IdentityAccessModuleOptions,
} from "./modules/identity-access/identity-access.module";

@Module({})
export class AppModule {
  static register(
    environment: RuntimeEnvironment,
    identityOptions: IdentityAccessModuleOptions = {},
  ): DynamicModule {
    return {
      module: AppModule,
      controllers: [HealthController],
      imports: [IdentityAccessModule.register(environment, identityOptions)],
    };
  }
}
