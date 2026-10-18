export async function respond(request: Request, content: string, contentType = "text/html; charset=utf-8") {
  const headers = new Headers({
    "Content-Type": contentType,
    "Cache-Control": "public, max-age=0, must-revalidate",
    Vary: "Accept-Encoding",
    "Content-Security-Policy": "default-src 'self'; img-src 'self' data: https:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
  });
  const acceptsGzip = (request.headers.get("accept-encoding") || "").split(",").some((entry) => {
    const [encoding, ...parameters] = entry.trim().toLowerCase().split(";");
    const quality = parameters.find((p) => p.trim().startsWith("q="));
    return encoding === "gzip" && (!quality || Number(quality.trim().slice(2)) > 0);
  });
  if (acceptsGzip) {
    headers.set("Content-Encoding", "gzip");
    return new Response(new Response(content).body!.pipeThrough(new CompressionStream("gzip")), { headers });
  }
  return new Response(content, { headers });
}
