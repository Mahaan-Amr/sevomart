import { Controller, Get } from "@nestjs/common";
import { ApiOkResponse, ApiProperty, ApiTags } from "@nestjs/swagger";
import type { HealthResponse } from "@sevo/contracts";

class HealthResponseDto implements HealthResponse {
  @ApiProperty({ example: "ok", enum: ["ok"] })
  status = "ok" as const;

  @ApiProperty({ example: "api", enum: ["api"] })
  service = "api" as const;

  @ApiProperty({ example: 1, enum: [1] })
  version = 1 as const;
}

@ApiTags("operations")
@Controller("v1/health")
export class HealthController {
  @Get()
  @ApiOkResponse({ type: HealthResponseDto })
  read(): HealthResponse {
    return {
      status: "ok",
      service: "api",
      version: 1,
    };
  }
}
