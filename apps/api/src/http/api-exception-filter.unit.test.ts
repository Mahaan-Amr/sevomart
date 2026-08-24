import { HttpException, HttpStatus, type ArgumentsHost } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import { ApiExceptionFilter } from "./api-exception.filter";

function createHttpHost() {
  const send = vi.fn();
  const status = vi.fn(() => ({ send }));
  const header = vi.fn();
  const host = {
    switchToHttp: () => ({
      getRequest: () => ({ id: "correlation-123" }),
      getResponse: () => ({ status, header }),
    }),
  } as unknown as ArgumentsHost;

  return { header, host, send, status };
}

describe("ApiExceptionFilter", () => {
  it("returns a traceable request error for an expected HTTP exception", () => {
    const { host, send, status } = createHttpHost();

    new ApiExceptionFilter().catch(
      new HttpException("invalid", HttpStatus.BAD_REQUEST),
      host,
    );

    expect(status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(send).toHaveBeenCalledWith({
      code: "REQUEST_ERROR",
      message: "درخواست انجام نشد. دوباره تلاش کنید.",
      correlationId: "correlation-123",
    });
  });

  it("hides an unexpected exception behind a traceable internal error", () => {
    const { host, send, status } = createHttpHost();

    new ApiExceptionFilter().catch(new Error("sensitive detail"), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(send).toHaveBeenCalledWith({
      code: "INTERNAL_SERVER_ERROR",
      message: "درخواست انجام نشد. دوباره تلاش کنید.",
      correlationId: "correlation-123",
    });
  });

  it("tells an idempotent client when to retry an in-progress command", () => {
    const { header, host } = createHttpHost();
    new ApiExceptionFilter().catch(
      new HttpException(
        {
          code: "IDEMPOTENCY_IN_PROGRESS",
          message: "retry",
          correlationId: "correlation-123",
        },
        HttpStatus.CONFLICT,
      ),
      host,
    );
    expect(header).toHaveBeenCalledWith("retry-after", "1");
  });
});
