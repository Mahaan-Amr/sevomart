const API_BASE_URL = process.env.API_BASE_URL ?? "http://127.0.0.1:3001";

export async function proxyAddressesRequest(
  request: Request,
  segments: readonly string[],
): Promise<Response> {
  if (!isAllowed(segments)) {
    return Response.json({ message: "مسیر درخواست معتبر نیست." }, { status: 404 });
  }
  const suffix = segments.length ? `/${encodeURIComponent(segments[0]!)}` : "";
  try {
    const headers = new Headers({
      cookie: request.headers.get("cookie") ?? "",
      "x-correlation-id":
        request.headers.get("x-correlation-id") ?? crypto.randomUUID(),
    });
    for (const name of ["content-type", "idempotency-key"]) {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }
    const hasBody = request.method !== "GET" && request.method !== "HEAD";
    const upstream = await fetch(`${API_BASE_URL}/v1/addresses${suffix}`, {
      method: request.method,
      headers,
      body: hasBody ? await request.arrayBuffer() : undefined,
      cache: "no-store",
    });
    const responseHeaders = new Headers({ "cache-control": "no-store" });
    const contentType = upstream.headers.get("content-type");
    if (contentType) responseHeaders.set("content-type", contentType);
    return new Response(upstream.body, {
      status: upstream.status,
      headers: responseHeaders,
    });
  } catch {
    return Response.json(
      {
        code: "INTERNAL_SERVER_ERROR",
        message: "ارتباط با سرور برقرار نشد. دوباره تلاش کنید.",
        correlationId: crypto.randomUUID(),
      },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}

function isAllowed(segments: readonly string[]) {
  return segments.length === 0 || /^[0-9a-f-]{36}$/.test(segments[0] ?? "");
}
