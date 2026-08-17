export function GET() {
  return Response.json({ status: "ok", service: "web", version: 1 });
}
