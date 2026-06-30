import DOMPurify, { type Config } from 'dompurify';

// Exported so unit tests can assert their local config stays in lockstep with
// production (happy-dom can't reliably verify element retention, but it can
// verify the allowlist hasn't silently narrowed).
export const PURIFY_CONFIG: Config = {
  ALLOWED_TAGS: [
    'strong', 'em', 'b', 'i', 'br', 'p', 'ul', 'ol', 'li',
    'span', 'div', 'a', 'small',
  ],
  ALLOWED_ATTR: ['class', 'href', 'target', 'rel'],
  ALLOW_DATA_ATTR: false,
  FORCE_BODY: false,
};

export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, PURIFY_CONFIG);
}
