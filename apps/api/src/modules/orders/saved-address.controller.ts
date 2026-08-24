import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Param,
  Post,
  Put,
  Req,
  Res,
} from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import {
  cartIdempotencyKeyContract,
  createSavedAddressInputContract,
  deleteSavedAddressInputContract,
  savedAddressIdContract,
  updateSavedAddressInputContract,
} from "@sevo/contracts/orders/v1";
import type { FastifyReply, FastifyRequest } from "fastify";

import { requireIdentity } from "../../http/identity-session";
import {
  IDENTITY_SESSION_READER,
  type IdentitySessionReader,
} from "../identity-access/public";
import { SavedAddressService } from "./application/saved-address.service";
import { SAVED_ADDRESS_SERVICE } from "./orders.tokens";
import {
  SavedAddressIdempotencyConflictError,
  SavedAddressNotFoundError,
  SavedAddressRevisionConflictError,
} from "./public";

@ApiExcludeController()
@Controller("v1/addresses")
export class SavedAddressController {
  constructor(
    @Inject(SAVED_ADDRESS_SERVICE)
    private readonly addresses: SavedAddressService,
    @Inject(IDENTITY_SESSION_READER)
    private readonly sessions: IdentitySessionReader,
  ) {}

  @Get()
  async list(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) response: FastifyReply,
  ) {
    noStore(response);
    const identityId = await requireIdentity(request, this.sessions);
    return this.addresses.list(identityId);
  }

  @Post()
  async create(
    @Body() body: unknown,
    @Headers("idempotency-key") rawKey: string | undefined,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) response: FastifyReply,
  ) {
    noStore(response);
    const input = createSavedAddressInputContract.safeParse(body);
    if (!input.success) throw addressValidationError(request.id, input.error.issues);
    const key = requireIdempotencyKey(request.id, rawKey);
    const identityId = await requireIdentity(request, this.sessions);
    try {
      return await this.addresses.create(identityId, input.data, key, request.id);
    } catch (error) {
      return addressError(error, request.id);
    }
  }

  @Put(":addressId")
  async update(
    @Param("addressId") rawAddressId: string,
    @Body() body: unknown,
    @Headers("idempotency-key") rawKey: string | undefined,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) response: FastifyReply,
  ) {
    noStore(response);
    const addressId = savedAddressIdContract.safeParse(rawAddressId);
    const input = updateSavedAddressInputContract.safeParse(body);
    if (!addressId.success || !input.success) {
      throw addressValidationError(request.id, input.success ? [] : input.error.issues);
    }
    const key = requireIdempotencyKey(request.id, rawKey);
    const identityId = await requireIdentity(request, this.sessions);
    try {
      return await this.addresses.update(
        identityId,
        addressId.data,
        input.data,
        key,
        request.id,
      );
    } catch (error) {
      return addressError(error, request.id);
    }
  }

  @Delete(":addressId")
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(
    @Param("addressId") rawAddressId: string,
    @Body() body: unknown,
    @Headers("idempotency-key") rawKey: string | undefined,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) response: FastifyReply,
  ) {
    noStore(response);
    const addressId = savedAddressIdContract.safeParse(rawAddressId);
    const input = deleteSavedAddressInputContract.safeParse(body);
    if (!addressId.success || !input.success) {
      throw addressValidationError(request.id, []);
    }
    const key = requireIdempotencyKey(request.id, rawKey);
    const identityId = await requireIdentity(request, this.sessions);
    try {
      await this.addresses.delete(
        identityId,
        addressId.data,
        input.data,
        key,
        request.id,
      );
    } catch (error) {
      return addressError(error, request.id);
    }
  }
}

function noStore(response: FastifyReply) {
  response.header("cache-control", "no-store");
}

function requireIdempotencyKey(correlationId: string, value: string | undefined) {
  const key = cartIdempotencyKeyContract.safeParse(value);
  if (!key.success) {
    throw new HttpException(
      {
        code: "PRECONDITION_REQUIRED",
        message: "شناسه یکتای درخواست لازم است.",
        correlationId,
      },
      HttpStatus.PRECONDITION_REQUIRED,
    );
  }
  return key.data;
}

function addressValidationError(
  correlationId: string,
  issues: ReadonlyArray<{ path: PropertyKey[] }>,
) {
  const mobileInvalid = issues.some((issue) => issue.path[0] === "recipientMobile");
  return new HttpException(
    {
      code: "ADDRESS_INVALID",
      message: mobileInvalid
        ? "شماره موبایل گیرنده باید با ۰۹ شروع شود و ۱۱ رقم باشد."
        : "نام گیرنده، استان، شهر، نشانی و کدپستی را بررسی کنید.",
      correlationId,
    },
    HttpStatus.UNPROCESSABLE_ENTITY,
  );
}

function addressError(error: unknown, correlationId: string): never {
  if (error instanceof SavedAddressNotFoundError) {
    throw new HttpException(
      { code: "ADDRESS_NOT_FOUND", message: "نشانی پیدا نشد.", correlationId },
      HttpStatus.NOT_FOUND,
    );
  }
  if (error instanceof SavedAddressRevisionConflictError) {
    throw new HttpException(
      {
        code: "ADDRESS_REVISION_CONFLICT",
        message: "نشانی در جای دیگری تغییر کرده است. نسخه تازه را ببینید.",
        correlationId,
        ...(error.current ? { currentAddress: error.current } : {}),
      },
      HttpStatus.CONFLICT,
    );
  }
  if (error instanceof SavedAddressIdempotencyConflictError) {
    throw new HttpException(
      {
        code: "IDEMPOTENCY_CONFLICT",
        message: "این شناسه درخواست قبلاً برای تغییر دیگری استفاده شده است.",
        correlationId,
      },
      HttpStatus.CONFLICT,
    );
  }
  throw error;
}
