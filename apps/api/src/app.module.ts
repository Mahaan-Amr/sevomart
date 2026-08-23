import { DynamicModule, Module } from "@nestjs/common";
import type { RuntimeEnvironment } from "@sevo/config";

import { HealthController, RUNTIME_READINESS } from "./health/health.controller";
import { createRuntimeReadinessCheck } from "./health/runtime-readiness";
import { composeCanonicalApiModules } from "./composition/module-registry";
import type { IdentityAccessModuleOptions } from "./modules/identity-access/composition";

@Module({})
export class AppModule {
  static register(
    environment: RuntimeEnvironment,
    identityOptions: IdentityAccessModuleOptions = {},
  ): DynamicModule {
    return {
      module: AppModule,
      controllers: [HealthController],
      providers: [
        {
          provide: RUNTIME_READINESS,
          useValue: createRuntimeReadinessCheck(environment),
        },
      ],
      imports: composeCanonicalApiModules(environment, identityOptions),
    };
  }
}
