const API_BASE_URL = process.env.API_BASE_URL ?? "http://127.0.0.1:3001";

export async function proxyStoreRequest(
  request: Request,
  segments: readonly string[],
): Promise<Response> {
  if (!isAllowedPath(segments)) {
    return Response.json({ message: "مسیر درخواست معتبر نیست." }, { status: 404 });
  }
  const path = `/v1/${segments.map(encodeURIComponent).join("/")}`;
  try {
    const headers = new Headers({
      cookie: request.headers.get("cookie") ?? "",
      "x-correlation-id":
        request.headers.get("x-correlation-id") ?? crypto.randomUUID(),
    });
    const contentType = request.headers.get("content-type");
    if (contentType) headers.set("content-type", contentType);
    const hasBody = request.method !== "GET" && request.method !== "HEAD";
    const upstream = await fetch(`${API_BASE_URL}${path}`, {
      method: request.method,
      headers,
      body: hasBody ? await request.arrayBuffer() : undefined,
      cache: "no-store",
    });
    const responseHeaders = new Headers();
    const upstreamContentType = upstream.headers.get("content-type");
    if (upstreamContentType) {
      responseHeaders.set("content-type", upstreamContentType);
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

function isAllowedPath(segments: readonly string[]) {
  const path = segments.join("/");
  return (
    path === "seller/store/draft" ||
    path === "seller/store/preview" ||
    path === "seller/store/publication" ||
    path === "seller/media" ||
    /^stores\/[a-z0-9-]+$/.test(path) ||
    /^store-slugs\/[a-z0-9-]+\/availability$/.test(path) ||
    /^media\/[0-9a-f-]{36}$/.test(path)
  );
}
