import { strict as assert } from 'node:assert';
import test from 'node:test';
import { Window } from 'happy-dom';
import DOMPurify from 'dompurify';

// Provide happy-dom as the DOM environment for DOMPurify (mirrors browser usage)
const window = new Window();
const purify = DOMPurify(window);

const PURIFY_CONFIG = {
  ALLOWED_TAGS: [
    'strong', 'em', 'b', 'i', 'br', 'p', 'ul', 'ol', 'li',
    'span', 'div', 'a', 'small',
  ],
  ALLOWED_ATTR: ['class', 'href', 'target', 'rel'],
  ALLOW_DATA_ATTR: false,
  FORCE_BODY: false,
};

function sanitizeHtml(html) {
  return purify.sanitize(html, PURIFY_CONFIG);
}

// ==================== XSS payload tests ====================

test('sanitizeHtml strips script tags', () => {
  const result = sanitizeHtml('<script>alert(1)</script><p>hello</p>');
  assert.ok(!result.includes('<script'), 'script tag must be removed');
  assert.ok(result.includes('hello'), 'safe content must survive');
});

test('sanitizeHtml strips inline script via src attribute', () => {
  const result = sanitizeHtml('<script src="https://evil.com/xss.js"></script>');
  assert.ok(!result.includes('<script'), 'script src tag must be removed');
});

test('sanitizeHtml strips onerror event handler', () => {
  const result = sanitizeHtml('<img src=x onerror="alert(1)">');
  assert.ok(!result.includes('onerror'), 'onerror must be stripped');
});

test('sanitizeHtml strips onload event handler', () => {
  const result = sanitizeHtml('<body onload="alert(1)">text</body>');
  assert.ok(!result.includes('onload'), 'onload must be stripped');
});

test('sanitizeHtml strips onclick event handler', () => {
  const result = sanitizeHtml('<div onclick="stealData()">click me</div>');
  assert.ok(!result.includes('onclick'), 'onclick must be stripped');
});

test('sanitizeHtml strips javascript: href', () => {
  const result = sanitizeHtml('<a href="javascript:alert(1)">click</a>');
  assert.ok(!result.includes('javascript:'), 'javascript: URI must be stripped');
});

test('sanitizeHtml strips data: URI href', () => {
  const result = sanitizeHtml('<a href="data:text/html,<script>alert(1)</script>">click</a>');
  assert.ok(!result.includes('data:'), 'data: URI must be stripped');
});

test('sanitizeHtml strips style attribute (SEC-008 companion)', () => {
  const result = sanitizeHtml('<div style="background:url(https://evil.com/track.gif)">text</div>');
  assert.ok(!result.includes('style='), 'style attribute must be stripped');
});

test('sanitizeHtml strips style attribute with expression', () => {
  const result = sanitizeHtml('<span style="color:expression(alert(1))">text</span>');
  assert.ok(!result.includes('style='), 'style with expression must be stripped');
});

test('sanitizeHtml strips SVG-based payload', () => {
  const result = sanitizeHtml('<svg><script>alert(1)</script></svg>');
  assert.ok(!result.includes('alert(1)'), 'SVG script payload must be stripped');
});

test('sanitizeHtml strips SVG with onload', () => {
  const result = sanitizeHtml('<svg onload="alert(1)"></svg>');
  assert.ok(!result.includes('onload'), 'SVG onload must be stripped');
});

test('sanitizeHtml strips iframe', () => {
  const result = sanitizeHtml('<iframe src="https://evil.com" sandbox></iframe>');
  assert.ok(!result.includes('iframe'), 'iframe must be stripped');
});

test('sanitizeHtml strips object tags', () => {
  const result = sanitizeHtml('<object data="https://evil.com/payload.swf"></object>');
  assert.ok(!result.includes('object'), 'object tag must be stripped');
});

test('sanitizeHtml strips data attributes', () => {
  const result = sanitizeHtml('<span data-evil="exfiltrate">text</span>');
  assert.ok(!result.includes('data-evil'), 'data-* attributes must be stripped');
});

// ==================== Safe content passthrough tests ====================

test('sanitizeHtml preserves strong and em tags', () => {
  const result = sanitizeHtml('<p>Hello <strong>world</strong> and <em>italic</em></p>');
  assert.ok(result.includes('<strong>'), 'strong must survive');
  assert.ok(result.includes('<em>'), 'em must survive');
});

test('sanitizeHtml preserves class attributes', () => {
  const result = sanitizeHtml('<div class="intel-brief">content</div>');
  assert.ok(result.includes('class='), 'class attribute must survive');
  assert.ok(result.includes('intel-brief'), 'class value must survive');
});

test('sanitizeHtml preserves https href', () => {
  const result = sanitizeHtml('<a href="https://example.com" rel="noopener">link</a>');
  assert.ok(result.includes('href='), 'https href must survive');
});

test('sanitizeHtml preserves target and rel attributes', () => {
  const result = sanitizeHtml('<a href="https://example.com" target="_blank" rel="noopener noreferrer">link</a>');
  assert.ok(result.includes('target='), 'target must survive');
  assert.ok(result.includes('rel='), 'rel must survive');
});

test('sanitizeHtml handles AI markdown-rendered output', () => {
  const aiOutput = '<div class="ib-content"><strong>Alert:</strong> Hurricane <em>Beryl</em><br>Status: Active<p>Prepare now.</p></div>';
  const result = sanitizeHtml(aiOutput);
  assert.ok(result.includes('<strong>'), 'bold must survive');
  assert.ok(result.includes('<em>'), 'em must survive');
  assert.ok(result.includes('<br'), 'br must survive');
  assert.ok(result.includes('<p>'), 'p must survive');
});

test('sanitizeHtml returns empty string for empty input', () => {
  assert.equal(sanitizeHtml(''), '');
});

test('sanitizeHtml passes through plain text', () => {
  const result = sanitizeHtml('Just plain text with no HTML');
  assert.ok(result.includes('Just plain text'), 'plain text must pass through');
});
