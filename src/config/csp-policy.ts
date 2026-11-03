export function removeWebLoopbackCspSources(html: string): string {
  return html.replace(
    / http:\/\/(?:127\.0\.0\.1|localhost)(?::(?:3000|1420|5173|46123))?/g,
    '',
  );
}

export const SIDECAR_PORT_RANGE = Object.freeze({ first: 46_123, last: 46_133 });

export const SIDECAR_CSP_ORIGINS: readonly string[] = Object.freeze(
  Array.from(
    { length: SIDECAR_PORT_RANGE.last - SIDECAR_PORT_RANGE.first + 1 },
    (_, offset) => `http://127.0.0.1:${SIDECAR_PORT_RANGE.first + offset}`,
  ),
);

export const LOCAL_MODEL_CSP_ORIGINS: readonly string[] = Object.freeze([
  'http://127.0.0.1:11434',
  'http://127.0.0.1:1234',
]);
