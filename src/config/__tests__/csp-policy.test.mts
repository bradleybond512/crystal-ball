import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { LOCAL_MODEL_CSP_ORIGINS, SIDECAR_CSP_ORIGINS, removeWebLoopbackCspSources, rewriteIndirectEvalThis } from '../csp-policy.ts';
import { SPZ_UNSUPPORTED_MESSAGE, loadSpz, loadSpzFromUrl } from '../../shims/spz-loader-unsupported.ts';

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

// ── R3-SEC-004 / R4-SEC-008 ──────────────────────────────────────────────────
test('the shared loopback lists match the Tauri CSP exactly', () => {
  const directive = (name: string) => (tauri.app.security.csp.split(';').map((p) => p.trim())
    .find((p) => p.startsWith(`${name} `)) ?? '').split(/\s+/).slice(1);
  const loopback = (list: string[]) => list.filter((e) => e.startsWith('http://127.0.0.1:'));
  assert.deepEqual(loopback(directive('connect-src')), [...SIDECAR_CSP_ORIGINS, ...LOCAL_MODEL_CSP_ORIGINS]);
  assert.deepEqual(loopback(directive('frame-src')), [...SIDECAR_CSP_ORIGINS]);
  assert.equal(SIDECAR_CSP_ORIGINS.length, 11);
  assert.equal(SIDECAR_CSP_ORIGINS[0], 'http://127.0.0.1:46123');
  assert.equal(SIDECAR_CSP_ORIGINS.at(-1), 'http://127.0.0.1:46133');
});

test("Knockout's indirect eval of 'this' becomes globalThis in every quote style, and nothing else changes", () => {
  for (const q of ['"', "'", '`']) {
    const input = `var A=this||(0,eval)(${q}this${q}),w=A.document;`;
    assert.deepEqual(rewriteIndirectEvalThis(input), { code: 'var A=this||globalThis,w=A.document;', count: 1 });
  }
  assert.deepEqual(rewriteIndirectEvalThis('x=( 0 , eval )( "this" )'), { code: 'x=globalThis', count: 1 });
  for (const untouched of ['eval("this")', '(0,eval)("that")', '(1,eval)("this")', 'obj.eval("this")', '(0,eval)(code)']) {
    assert.deepEqual(rewriteIndirectEvalThis(untouched), { code: untouched, count: 0 }, untouched);
  }
});

test('the SPZ stand-in rejects every decode with a clear reason', async () => {
  await assert.rejects(loadSpz(), { message: SPZ_UNSUPPORTED_MESSAGE });
  await assert.rejects(loadSpzFromUrl(), { message: SPZ_UNSUPPORTED_MESSAGE });
  assert.match(SPZ_UNSUPPORTED_MESSAGE, /CSP/);
});
