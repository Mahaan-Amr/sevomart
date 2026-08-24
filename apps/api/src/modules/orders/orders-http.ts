import { HttpException, HttpStatus } from "@nestjs/common";
import { cartIdempotencyKeyContract } from "@sevo/contracts/orders/v1";

export function requireIdempotencyKey(
  correlationId: string,
  value: string | undefined,
) {
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
