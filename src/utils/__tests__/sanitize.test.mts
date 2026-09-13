import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { escapeHtml, sanitizeUrl } from '../sanitize';

describe('escapeHtml', () => {
  it('escapes angle brackets (tag injection)', () => {
    assert.equal(escapeHtml('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');
    assert.equal(escapeHtml('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
    assert.equal(escapeHtml('<svg onload=alert(1)>'), '&lt;svg onload=alert(1)&gt;');
  });

  it('escapes double quotes (attribute injection)', () => {
    assert.equal(escapeHtml('"hello"'), '&quot;hello&quot;');
    assert.equal(escapeHtml('"><script>alert(1)</script>'), '&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('escapes single quotes (attribute injection via single-quote context)', () => {
    assert.equal(escapeHtml("it's fine"), "it&#39;s fine");
    assert.equal(escapeHtml("' onmouseover='alert(1)"), "&#39; onmouseover=&#39;alert(1)");
  });

  it('escapes ampersands (entity injection)', () => {
    assert.equal(escapeHtml('a & b'), 'a &amp; b');
    assert.equal(escapeHtml('&amp;'), '&amp;amp;');
  });

  it('returns empty string for null and undefined', () => {
    assert.equal(escapeHtml(''), '');
    assert.equal(escapeHtml(null as unknown as string), '');
    assert.equal(escapeHtml(undefined as unknown as string), '');
  });

  // Regression guard. The function used to bail on `!str`, so a falsy
  // non-nullish value arriving through an `any` boundary rendered as an empty
  // string and the content vanished silently. Only null/undefined short-circuit
  // now. Most callers wrap in String(...), so this is the unwrapped path.
  it('renders falsy non-nullish values instead of dropping them', () => {
    assert.equal(escapeHtml(0 as unknown as string), '0');
    assert.equal(escapeHtml(false as unknown as string), 'false');
    assert.equal(escapeHtml(Number.NaN as unknown as string), 'NaN');
  });

  it('passes through plain text unchanged', () => {
    assert.equal(escapeHtml('Hello, world!'), 'Hello, world!');
    assert.equal(escapeHtml('price: $9.99'), 'price: $9.99');
  });
});

describe('sanitizeUrl — dangerous protocol rejection', () => {
  it('rejects javascript: URIs', () => {
    assert.equal(sanitizeUrl('javascript:alert(1)'), '');
    assert.equal(sanitizeUrl('javascript:void(0)'), '');
    assert.equal(sanitizeUrl('JAVASCRIPT:alert(1)'), '');
  });

  it('rejects data: URIs', () => {
    assert.equal(sanitizeUrl('data:text/html,<script>alert(1)</script>'), '');
    assert.equal(sanitizeUrl('data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+'), '');
  });

  it('rejects vbscript: URIs', () => {
    assert.equal(sanitizeUrl('vbscript:msgbox(1)'), '');
  });
});

describe('sanitizeUrl — SSRF / private IP rejection', () => {
  it('rejects loopback addresses', () => {
    assert.equal(sanitizeUrl('http://127.0.0.1/admin'), '');
    assert.equal(sanitizeUrl('http://127.0.0.1:8080/'), '');
    assert.equal(sanitizeUrl('http://localhost/secret'), '');
  });

  it('rejects RFC-1918 private ranges', () => {
    assert.equal(sanitizeUrl('https://10.0.0.1/'), '');
    assert.equal(sanitizeUrl('https://172.16.0.1/'), '');
    assert.equal(sanitizeUrl('https://192.168.1.1/'), '');
  });

  it('rejects link-local addresses', () => {
    assert.equal(sanitizeUrl('http://169.254.169.254/latest/meta-data/'), '');
  });

  // The branch most hand-rolled SSRF filters miss. Both spellings reach the
  // same address, and the hex form contains no dots at all, so a naive
  // dotted-quad check waves it straight through to the metadata endpoint.
  it('rejects IPv4-mapped IPv6 in dotted form', () => {
    assert.equal(sanitizeUrl('http://[::ffff:127.0.0.1]/'), '');
    assert.equal(sanitizeUrl('http://[::ffff:169.254.169.254]/latest/meta-data/'), '');
    assert.equal(sanitizeUrl('http://[::ffff:10.0.0.1]/'), '');
  });

  it('rejects IPv4-mapped IPv6 in hex form', () => {
    assert.equal(sanitizeUrl('http://[::ffff:7f00:1]/'), '');       // 127.0.0.1
    assert.equal(sanitizeUrl('http://[::ffff:a9fe:a9fe]/'), '');    // 169.254.169.254
    assert.equal(sanitizeUrl('http://[::ffff:c0a8:1]/'), '');       // 192.168.0.1
  });

  it('rejects IPv6 loopback, unique-local and link-local literals', () => {
    assert.equal(sanitizeUrl('http://[::1]/'), '');
    assert.equal(sanitizeUrl('http://[fc00::1]/'), '');
    assert.equal(sanitizeUrl('http://[fd12:3456::1]/'), '');
    assert.equal(sanitizeUrl('http://[fe80::1]/'), '');
  });

  it('rejects 0.0.0.0/8 and multicast', () => {
    assert.equal(sanitizeUrl('http://0.0.0.0/'), '');
    assert.equal(sanitizeUrl('http://224.0.0.1/'), '');
    assert.equal(sanitizeUrl('http://239.255.255.250/'), '');
  });

  // Trailing dots are equivalent to no trailing dot in DNS, so they must not
  // be usable to slip a blocked host past the check.
  it('rejects blocked hosts written with trailing dots', () => {
    assert.equal(sanitizeUrl('http://localhost./'), '');
    assert.equal(sanitizeUrl('http://localhost.../'), '');
  });
});

describe('sanitizeUrl — allowed URLs', () => {
  it('accepts well-formed https URLs on public hosts', () => {
    const result = sanitizeUrl('https://example.com/path?q=1');
    assert.ok(result.length > 0, 'should return a non-empty string');
    assert.ok(result.includes('example.com'), 'should preserve host');
  });

  it('accepts http URLs on public hosts', () => {
    const result = sanitizeUrl('http://example.com/feed.rss');
    assert.ok(result.length > 0);
  });

  it('accepts relative paths', () => {
    assert.equal(sanitizeUrl('/dashboard'), '/dashboard');
    assert.equal(sanitizeUrl('./report'), './report');
    assert.equal(sanitizeUrl('?page=2'), '?page=2');
    assert.equal(sanitizeUrl('#section'), '#section');
  });

  it('returns empty string for bare word inputs (no protocol, not relative)', () => {
    assert.equal(sanitizeUrl('evil.com'), '');
    assert.equal(sanitizeUrl('evil.com/path'), '');
  });

  it('returns empty string for empty input', () => {
    assert.equal(sanitizeUrl(''), '');
  });
});
