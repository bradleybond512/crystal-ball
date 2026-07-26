export function removeWebLoopbackCspSources(html: string): string {
  return html.replace(
    / http:\/\/(?:127\.0\.0\.1|localhost)(?::(?:3000|1420|5173|46123))?/g,
    '',
  );
}
