import {
  identityAccessV1Paths,
  identitySessionContract,
  type IdentitySession,
} from "@sevo/contracts/identity-access/v1";

const API_BASE_URL = process.env.API_BASE_URL ?? "http://127.0.0.1:3001";

export async function proxyIdentityRequest(
  request: Request,
  path: string,
  forwardSessionCookie = false,
): Promise<Response> {
  try {
    const search = new URL(request.url).search;
    const upstream = await fetch(`${API_BASE_URL}${path}${search}`, {
      method: request.method,
      headers: {
        ...(request.headers.get("content-type")
          ? { "content-type": request.headers.get("content-type")! }
          : {}),
        ...(request.headers.get("cookie")
          ? { cookie: request.headers.get("cookie")! }
          : {}),
        ...(request.headers.get("idempotency-key")
          ? { "idempotency-key": request.headers.get("idempotency-key")! }
          : {}),
        "x-correlation-id":
          request.headers.get("x-correlation-id") ?? crypto.randomUUID(),
      },
      body:
        request.method === "GET" || request.method === "HEAD"
          ? undefined
          : await request.text(),
      cache: "no-store",
    });
    const headers = new Headers({ "content-type": "application/json" });
    const sessionCookie = upstream.headers.get("set-cookie");
    if (forwardSessionCookie && sessionCookie) {
      headers.set("set-cookie", sessionCookie);
    }
    const retryAfter = upstream.headers.get("retry-after");
    if (retryAfter) headers.set("retry-after", retryAfter);
    const body = upstream.status === 204 ? null : await upstream.text();
    return new Response(body, {
      status: upstream.status,
      headers,
    });
  } catch {
    return Response.json(
      {
        code: "INTERNAL_SERVER_ERROR",
        message: "ارتباط با سرور برقرار نشد. دوباره تلاش کنید.",
        correlationId: crypto.randomUUID(),
      },
      { status: 503 },
    );
  }
}

export async function readIdentitySession(
  cookieHeader: string,
): Promise<IdentitySession | undefined> {
  try {
    const response = await fetch(
      `${API_BASE_URL}${identityAccessV1Paths.readSession}`,
      {
        headers: { cookie: cookieHeader },
        cache: "no-store",
      },
    );
    if (!response.ok) return undefined;
    const parsed = identitySessionContract.safeParse(await response.json());
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}
