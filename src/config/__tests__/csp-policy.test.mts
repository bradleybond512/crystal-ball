import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { removeWebLoopbackCspSources } from '../csp-policy.ts';

const index = readFileSync(new URL('../../../index.html', import.meta.url), 'utf8');
const vercel = JSON.parse(readFileSync(
  new URL('../../../vercel.json', import.meta.url),
  'utf8',
)) as { headers: Array<{ headers: Array<{ key: string; value: string }> }> };
const tauri = JSON.parse(readFileSync(
  new URL('../../../src-tauri/tauri.conf.json', import.meta.url),
  'utf8',
)) as { app: { security: { csp: string } } };

test('Vercel adds only header-only CSP directives and lets the web meta policy govern resources', () => {
  const policy = vercel.headers
    .flatMap((entry) => entry.headers)
    .find((header) => header.key === 'Content-Security-Policy')?.value;
  assert.equal(
    policy,
    "frame-ancestors 'self'; object-src 'none'; base-uri 'self'; form-action 'self'",
  );
});

test('web CSP does not expose loopback services; desktop CSP owns that delta', () => {
  const builtWeb = removeWebLoopbackCspSources(index);
  const webPolicy = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(builtWeb)?.[1] ?? '';
  assert.doesNotMatch(webPolicy, /http:\/\/(?:127\.0\.0\.1|localhost)/);
  assert.match(tauri.app.security.csp, /connect-src[^;]*http:\/\/127\.0\.0\.1:46123/);
  assert.doesNotMatch(tauri.app.security.csp, /connect-src[^;]*\shttps:\s/);
});
