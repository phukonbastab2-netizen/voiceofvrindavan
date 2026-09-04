export async function onRequestPost({ request, env }) {
  if (!env.MODEL_API_URL || !env.MODEL_API_KEY) {
    return Response.json({ detail: "Model service is not configured" }, { status: 503 });
  }
  const body = await request.text();
  if (body.length > 52000) return Response.json({ detail: "Request too large" }, { status: 413 });
  const upstream = await fetch(`${env.MODEL_API_URL.replace(/\/$/, "")}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.MODEL_API_KEY}` },
    body,
  });
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
