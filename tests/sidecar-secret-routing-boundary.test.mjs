// R4-BUG-004 source gates: every renderer call that carries the sidecar
// bearer token or a plaintext secret outside the fetch patch resolves a
// CONFIRMED sidecar base first and sends nothing without one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

function fnBody(source, name) {
  const start = source.search(new RegExp(`function ${name}\\s*\\(`));
  assert.ok(start >= 0, `function ${name} not found`);
  const open = source.indexOf('{', source.indexOf(')', start));
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}' && --depth === 0) return source.slice(open, i + 1);
  }
  throw new Error(`unbalanced ${name}`);
}

function gatedBeforeFetch(body, label) {
  const resolve = body.indexOf('await resolveConfirmedLocalApiBase()');
  const guard = body.search(/if \(!base\) (?:return;|\{?\s*throw )/);
  const send = body.search(/\bfetch\(`\$\{base\}/);
  assert.ok(resolve >= 0, `${label}: resolves a confirmed base`);
  assert.ok(guard > resolve, `${label}: stops without a confirmed base`);
  assert.ok(send > guard, `${label}: sends only to that base`);
}

test('Settings key sync and key validation only reach a confirmed sidecar', () => {
  const runtimeConfig = read('src/services/runtime-config.ts');
  gatedBeforeFetch(fnBody(runtimeConfig, 'pushSecretToSidecar'), 'pushSecretToSidecar');
  gatedBeforeFetch(fnBody(runtimeConfig, 'callSidecarWithAuth'), 'callSidecarWithAuth');
  assert.doesNotMatch(runtimeConfig, /\bgetApiBaseUrl\b/, 'no default-port base for secret-bearing calls');
});

test('Settings window diagnostics only send the bearer token to a confirmed sidecar', () => {
  const settings = read('src/settings-main.ts');
  gatedBeforeFetch(fnBody(settings, 'diagFetch'), 'diagFetch');
  assert.doesNotMatch(settings, /\bgetSidecarBase\b|\bgetApiBaseUrl\b/);
});

test('the fetch patch builds local URLs from the port it resolved, never a re-read global', () => {
  const runtime = read('src/services/runtime.ts');
  const patch = fnBody(runtime, 'createRuntimeFetch');
  assert.match(patch, /const port = await deps\.resolvePort\(\);/);
  assert.match(patch, /if \(port === null\) \{\s*throw new Error/);
  assert.match(patch, /deps\.localBaseUrl\(port\)/);
  assert.match(patch, /deps\.localBaseUrl\(retryPort\)/);
  assert.doesNotMatch(patch, /getApiBaseUrl\(\)/);
  assert.match(fnBody(runtime, 'installRuntimeFetchPatch'), /resolvePort: \(\) => resolveConfirmedLocalApiPort\(\)/);
});
