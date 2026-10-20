export async function respond(_request: Request, content: string, contentType = "text/html; charset=utf-8") {
  const headers = new Headers({
    "Content-Type": contentType,
    "Cache-Control": "public, max-age=0, must-revalidate",
    "Content-Security-Policy": "default-src 'self'; img-src 'self' data: https:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
  });
  return new Response(content, { headers });
}
