const API_BASE_URL = process.env.API_BASE_URL ?? "http://127.0.0.1:3001";

export async function proxyJsonApiRequest(
  request: Request,
  segments: readonly string[],
  options: {
    basePath: string;
    isAllowed: (segments: readonly string[]) => boolean;
    responseHeaders: readonly string[];
    noStore?: boolean;
  },
): Promise<Response> {
  if (!options.isAllowed(segments)) {
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
    for (const name of ["content-type", "idempotency-key", "x-sevo-guest-scope"]) {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }
    const hasBody = request.method !== "GET" && request.method !== "HEAD";
    const search = new URL(request.url).search;
    const upstream = await fetch(
      `${API_BASE_URL}${options.basePath}${suffix}${search}`,
      {
        method: request.method,
        headers,
        body: hasBody ? await request.arrayBuffer() : undefined,
        cache: "no-store",
      },
    );
    const responseHeaders = new Headers();
    if (options.noStore) responseHeaders.set("cache-control", "no-store");
    for (const name of options.responseHeaders) {
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
      {
        status: 503,
        ...(options.noStore ? { headers: { "cache-control": "no-store" } } : {}),
      },
    );
  }
}
