import { Controller, Get, HttpException, HttpStatus, Inject } from "@nestjs/common";
import { ApiOkResponse, ApiProperty, ApiTags } from "@nestjs/swagger";
import type { HealthResponse } from "@sevo/contracts";

export const RUNTIME_ENVIRONMENT = Symbol("RUNTIME_ENVIRONMENT");
export const RUNTIME_READINESS = Symbol("RUNTIME_READINESS");

class HealthResponseDto implements HealthResponse {
  @ApiProperty({ example: "ok", enum: ["ok"] })
  status = "ok" as const;
  @ApiProperty({ example: "api", enum: ["api"] })
  service = "api" as const;
  @ApiProperty({ example: 1, enum: [1] })
  version = 1 as const;
}

@ApiTags("operations")
@Controller()
export class HealthController {
  constructor(
    @Inject(RUNTIME_READINESS)
    private readonly dependenciesReady: () => Promise<boolean>,
  ) {}

  @Get(["health/live", "v1/health"])
  @ApiOkResponse({ type: HealthResponseDto })
  live(): HealthResponse {
    return { status: "ok", service: "api", version: 1 };
  }

  @Get("health/ready")
  async ready(): Promise<HealthResponse> {
    if (await this.dependenciesReady()) {
      return this.live();
    }
    throw new HttpException(
      { status: "unavailable", service: "api", version: 1 },
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
}
