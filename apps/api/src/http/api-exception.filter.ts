import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<FastifyRequest>();
    const reply = context.getResponse<FastifyReply>();
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const response =
      exception instanceof HttpException ? exception.getResponse() : null;
    if (typeof response === "object" && response !== null && "code" in response) {
      if (response.code === "IDEMPOTENCY_IN_PROGRESS") {
        void reply.header("retry-after", "1");
      }
      void reply.status(status).send(response);
      return;
    }

    void reply.status(status).send({
      code:
        status === HttpStatus.INTERNAL_SERVER_ERROR
          ? "INTERNAL_SERVER_ERROR"
          : "REQUEST_ERROR",
      message: "درخواست انجام نشد. دوباره تلاش کنید.",
      correlationId: request.id,
    });
  }
}
