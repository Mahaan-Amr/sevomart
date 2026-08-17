export async function GET() {
  try {
    const response = await fetch(
      `${process.env.API_BASE_URL ?? "http://127.0.0.1:3201"}/health/ready`,
      { cache: "no-store", signal: AbortSignal.timeout(2_000) },
    );
    if (!response.ok) throw new Error("api unavailable");
    return Response.json({ status: "ok", service: "web", version: 1 });
  } catch {
    return Response.json(
      { status: "unavailable", service: "web", version: 1 },
      { status: 503 },
    );
  }
}
