import { timingSafeEqual } from "node:crypto";

import {
  Controller,
  Headers,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Param,
  Post,
} from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import type { RuntimeEnvironment } from "@sevo/config";

import {
  RUNTIME_ENVIRONMENT,
  SELLER_APPROVAL_RECOVERY,
} from "./identity-access.tokens";
import type { SellerApprovalRecovery } from "./public";

@ApiExcludeController()
@Controller("v1/internal/seller-approval-recoveries")
export class SellerApprovalRecoveryController {
  constructor(
    @Inject(SELLER_APPROVAL_RECOVERY)
    private readonly recovery: SellerApprovalRecovery,
    @Inject(RUNTIME_ENVIRONMENT)
    private readonly environment: RuntimeEnvironment,
  ) {}

  @Get("pending")
  async nextPending(
    @Headers("x-sevo-worker-secret") secret: string | undefined,
  ): Promise<{ recoveryId: string | null }> {
    this.#assertAuthorized(secret);
    const recoveryId = await this.recovery.nextPending();
    return { recoveryId };
  }

  @Post(":recoveryId")
  @HttpCode(HttpStatus.NO_CONTENT)
  async recover(
    @Param("recoveryId") recoveryId: string,
    @Headers("x-sevo-worker-secret") secret: string | undefined,
  ): Promise<void> {
    this.#assertAuthorized(secret);
    if (!UUID_PATTERN.test(recoveryId)) {
      throw new HttpException("Not found", HttpStatus.NOT_FOUND);
    }
    await this.recovery.recover(recoveryId);
  }

  #assertAuthorized(secret: string | undefined): void {
    if (!sameSecret(secret, this.environment.SELLER_APPROVAL_RECOVERY_SECRET)) {
      throw new HttpException("Forbidden", HttpStatus.FORBIDDEN);
    }
  }
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function sameSecret(actual: string | undefined, expected: string): boolean {
  if (!actual) return false;
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return (
    actualBytes.length === expectedBytes.length &&
    timingSafeEqual(actualBytes, expectedBytes)
  );
}
