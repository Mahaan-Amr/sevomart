import { Controller, Get, HttpException, HttpStatus, Inject } from "@nestjs/common";
import { ApiOkResponse, ApiProperty, ApiTags } from "@nestjs/swagger";
import type { RuntimeEnvironment } from "@sevo/config";
import type { HealthResponse } from "@sevo/contracts";
import { Client } from "minio";
import postgres from "postgres";

export const RUNTIME_ENVIRONMENT = Symbol("RUNTIME_ENVIRONMENT");

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
    @Inject(RUNTIME_ENVIRONMENT) private readonly environment: RuntimeEnvironment,
  ) {}

  @Get(["health/live", "v1/health"])
  @ApiOkResponse({ type: HealthResponseDto })
  live(): HealthResponse {
    return { status: "ok", service: "api", version: 1 };
  }

  @Get("health/ready")
  async ready(): Promise<HealthResponse> {
    const sql = postgres(this.environment.DATABASE_URL, { max: 1, connect_timeout: 2 });
    const minio = new Client({
      endPoint: this.environment.MINIO_ENDPOINT,
      port: this.environment.MINIO_PORT,
      useSSL: this.environment.MINIO_USE_SSL,
      accessKey: this.environment.MINIO_ACCESS_KEY,
      secretKey: this.environment.MINIO_SECRET_KEY,
    });
    try {
      const [, bucketExists] = await Promise.all([
        sql`select 1`,
        minio.bucketExists(this.environment.MINIO_BUCKET),
      ]);
      if (!bucketExists) throw new Error("media bucket is unavailable");
      return this.live();
    } catch {
      throw new HttpException(
        { status: "unavailable", service: "api", version: 1 },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    } finally {
      await sql.end({ timeout: 1 });
    }
  }
}
