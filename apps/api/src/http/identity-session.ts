import { HttpException, HttpStatus } from "@nestjs/common";
import type { IdentitySessionReader } from "../modules/identity-access/public";
import type { FastifyRequest } from "fastify";

export async function requireIdentity(
  request: FastifyRequest,
  sessions: IdentitySessionReader,
): Promise<string> {
  const token = readIdentitySessionToken(request) ?? "";
  const session = await sessions.readActiveIdentitySession(token);
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
  return session.actor.identityId;
}

export function readIdentitySessionToken(request: FastifyRequest): string | undefined {
  return readCookie(request.headers.cookie, "sevo_session");
}

function readCookie(header: string | undefined, name: string): string | undefined {
  return header
    ?.split(";")
    .map((part) => part.trim().split("="))
    .find(([key]) => key === name)
    ?.slice(1)
    .join("=");
}
