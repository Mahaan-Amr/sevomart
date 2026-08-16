const API_BASE_URL = process.env.API_BASE_URL ?? "http://127.0.0.1:3001";

export async function proxyIdentityRequest(
  request: Request,
  path: string,
  forwardSessionCookie = false,
): Promise<Response> {
  try {
    const upstream = await fetch(`${API_BASE_URL}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-correlation-id":
          request.headers.get("x-correlation-id") ?? crypto.randomUUID(),
      },
      body: await request.text(),
      cache: "no-store",
    });
    const headers = new Headers({ "content-type": "application/json" });
    const sessionCookie = upstream.headers.get("set-cookie");
    if (forwardSessionCookie && sessionCookie) {
      headers.set("set-cookie", sessionCookie);
    }
    return new Response(await upstream.text(), {
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
