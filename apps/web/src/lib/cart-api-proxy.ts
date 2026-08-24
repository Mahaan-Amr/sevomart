const API_BASE_URL = process.env.API_BASE_URL ?? "http://127.0.0.1:3001";

export async function proxyCartRequest(
  request: Request,
  segments: readonly string[],
): Promise<Response> {
  if (!isAllowed(segments)) {
    return Response.json({ message: "مسیر درخواست معتبر نیست." }, { status: 404 });
  }
  const suffix = segments.length
    ? `/${segments.map(encodeURIComponent).join("/")}`
    : "";
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
    const upstream = await fetch(`${API_BASE_URL}/v1/cart${suffix}`, {
      method: request.method,
      headers,
      body: hasBody ? await request.arrayBuffer() : undefined,
      cache: "no-store",
    });
    const responseHeaders = new Headers();
    for (const name of ["content-type", "set-cookie", "retry-after"]) {
      const value = upstream.headers.get(name);
      if (value) responseHeaders.set(name, value);
    }
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
      { status: 503 },
    );
  }
}

function isAllowed(segments: readonly string[]) {
  const path = segments.join("/");
  return (
    path === "" ||
    path === "attach" ||
    path === "identity-resolution" ||
    path === "store-replacement" ||
    /^items\/[0-9a-f-]{36}$/.test(path)
  );
}
