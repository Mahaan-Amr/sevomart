import { HttpException, HttpStatus } from "@nestjs/common";
import type { SellerSessionReader } from "../modules/identity-access/public";
import type { FastifyRequest } from "fastify";

export async function requireSeller(
  request: FastifyRequest,
  sessions: SellerSessionReader,
): Promise<string> {
  const token = readCookie(request.headers.cookie, "sevo_seller_session") ?? "";
  const session = await sessions.readActiveSellerSession(token);
  if (!session) {
    throw new HttpException(
      {
        code: "UNAUTHORIZED",
        message: "برای ادامه دوباره وارد شوید.",
        correlationId: request.id,
      },
      HttpStatus.UNAUTHORIZED,
    );
  }
  return session.seller.id;
}

function readCookie(header: string | undefined, name: string): string | undefined {
  return header
    ?.split(";")
    .map((part) => part.trim().split("="))
    .find(([key]) => key === name)
    ?.slice(1)
    .join("=");
}
