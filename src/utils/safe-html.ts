import DOMPurify, { type Config } from 'dompurify';

const PURIFY_CONFIG: Config = {
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
