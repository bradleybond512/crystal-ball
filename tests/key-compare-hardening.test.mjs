import assert from 'node:assert/strict';
import test from 'node:test';
import { timingSafeEqualString, timingSafeIncludes } from '../api/_timing-safe.js';
import { requireAppAuth } from '../api/_auth.js';

// These tests run sequentially: environment and prototype changes are restored
// before each callback returns, including when an assertion throws.
async function withEnv(values, callback) {
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  try {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    return await callback();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

let importId = 0;
async function loadApiKey() {
  const module = await import(`../api/_api-key.js?key-compare-test=${importId++}`);
  return module.validateApiKey;
}

function makeRequest({ key, origin, method = 'GET', site, mode } = {}) {
  const headers = {};
  if (key !== undefined) headers['X-CrystalBall-Key'] = key;
  if (origin !== undefined) headers.Origin = origin;
  if (site !== undefined) headers['Sec-Fetch-Site'] = site;
  if (mode !== undefined) headers['Sec-Fetch-Mode'] = mode;
  return new Request('https://crystalball.app/api/test', { method, headers });
}

function observeCodeUnits(strings, callback) {
  const watched = new Set(strings);
  const original = String.prototype.codePointAt;
  const visits = [];
  let result;
  try {
    String.prototype.codePointAt = function (index) {
      const value = String(this);
      if (watched.has(value)) visits.push([value, index]);
      return original.call(this, index);
    };
    result = callback();
  } finally {
    String.prototype.codePointAt = original;
  }
  return { result, visits };
}

function expectedVisits(left, right) {
  const visits = [];
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    visits.push([left, index], [right, index]);
  }
  return visits;
}

const equalityCases = [
  ['empty strings', '', '', true],
  ['equal ASCII', 'shared-secret', 'shared-secret', true],
  ['first ASCII mismatch', 'x-shared-secret', 'y-shared-secret', false],
  ['last ASCII mismatch', 'shared-secret-x', 'shared-secret-y', false],
  ['prefix length mismatch', 'shared-secret', 'shared-secret-extra', false],
  ['empty versus nonempty', '', 'a', false],
  ['embedded NUL equal', 'a\0b', 'a\0b', true],
  ['NUL suffix differs from absence', 'a', 'a\0', false],
  ['distinct NUL-containing strings', 'a\0b', 'a\0c', false],
  ['equal Latin-1', 'caf\u00e9', 'caf\u00e9', true],
  ['distinct Latin-1', 'caf\u00e9', 'caf\u00e8', false],
  ['equal non-Latin Unicode', '\u6c34\u9375', '\u6c34\u9375', true],
  ['combining differs from precomposed', 'e\u0301', '\u00e9', false],
  ['equal astral characters', '\u{1f511}', '\u{1f511}', true],
  ['distinct astral characters', '\u{1f511}', '\u{1f512}', false],
  ['astral differs from truncated BMP plus lone low surrogate', '\ud800\udc00', '\0\udc00', false],
  ['equal lone high surrogate', '\ud800', '\ud800', true],
  ['distinct lone high surrogates', '\ud800', '\ud801', false],
  ['equal lone low surrogate', '\udc00', '\udc00', true],
  ['distinct lone low surrogates', '\udc00', '\udc01', false],
  ['lone high versus lone low surrogate', '\ud800', '\udc00', false],
  ['lone high surrogate versus replacement character', '\ud800', '\ufffd', false],
  ['lone low surrogate versus replacement character', '\udc00', '\ufffd', false],
  ['embedded distinct lone surrogates', 'key-\ud800-end', 'key-\ud801-end', false],
];

for (const [name, left, right, expected] of equalityCases) {
  test(`comparison helper preserves string equality: ${name}`, () => {
    assert.equal(left === right, expected);
    assert.equal(timingSafeEqualString(left, right), expected);
    assert.equal(timingSafeEqualString(right, left), expected);
  });
}

test('comparison helper rejects malformed and missing operands without coercion', () => {
  const invalid = [undefined, null, 0, false, {}, [], new String('key'), Symbol('key')];
  for (const value of invalid) {
    assert.equal(timingSafeEqualString(value, 'key'), false);
    assert.equal(timingSafeEqualString('key', value), false);
    assert.equal(timingSafeEqualString(value, value), false);
  }
  assert.equal(timingSafeEqualString(), false);
});

test('comparison helper visits both strings through the full maximum code-unit length', () => {
  const cases = [
    ['same-secret', 'same-secret'],
    ['x-first-difference', 'y-first-difference'],
    ['last-difference-x', 'last-difference-y'],
    ['prefix', 'prefix\0extra'],
    ['', 'nonempty'],
  ];
  for (const [left, right] of cases) {
    const { result, visits } = observeCodeUnits([left, right], () => timingSafeEqualString(left, right));
    assert.equal(result, left === right);
    assert.deepEqual(visits, expectedVisits(left, right));
  }
});

test('includes helper matches only exact strings in arrays and sets', () => {
  for (const collection of [['alpha', 'caf\u00e9', '\ud800'], new Set(['alpha', 'caf\u00e9', '\ud800'])]) {
    assert.equal(timingSafeIncludes(collection, 'alpha'), true);
    assert.equal(timingSafeIncludes(collection, 'caf\u00e9'), true);
    assert.equal(timingSafeIncludes(collection, '\ud800'), true);
    assert.equal(timingSafeIncludes(collection, '\ud801'), false);
    assert.equal(timingSafeIncludes(collection, '\ufffd'), false);
    assert.equal(timingSafeIncludes(collection, 'alph'), false);
    assert.equal(timingSafeIncludes(collection, 'missing'), false);
  }
  assert.equal(timingSafeIncludes([], 'alpha'), false);
});

test('includes helper safely rejects missing and non-iterable collections', () => {
  for (const collection of [undefined, null, 1, false, {}, { [Symbol.iterator]: 1 }]) {
    assert.equal(timingSafeIncludes(collection, 'key'), false);
  }
  assert.equal(timingSafeIncludes(), false);
});

test('includes helper rejects malformed candidates and entries without coercion', () => {
  const invalid = [undefined, null, 1, false, {}, new String('key')];
  for (const value of invalid) {
    assert.equal(timingSafeIncludes(['key'], value), false);
    assert.equal(timingSafeIncludes([value], 'key'), false);
  }
  assert.equal(timingSafeIncludes([undefined, 'key', null], 'key'), true);
});

test('includes helper exhausts a generator and compares strings after an early match', () => {
  const yielded = [];
  const entries = ['match-key', 'second-key', 'third-key'];
  function* candidates() {
    for (const entry of entries) {
      yielded.push(entry);
      yield entry;
    }
  }
  const { result, visits } = observeCodeUnits(entries, () => timingSafeIncludes(candidates(), entries[0]));
  assert.equal(result, true);
  assert.deepEqual(yielded, entries);
  assert.deepEqual(visits, entries.flatMap(entry => expectedVisits(entry, entries[0])));
});

test('app auth preserves 403 unconfigured response, hint and CORS headers', async () => {
  await withEnv({ LOCAL_API_PORT: undefined, CRYSTALBALL_APP_KEY: undefined }, async () => {
    const cors = { 'access-control-allow-origin': 'https://crystalball.app', 'x-auth-test': 'cors-preserved' };
    const response = requireAppAuth(makeRequest({ key: 'anything' }), cors);
    assert.equal(response.status, 403);
    assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8');
    assert.equal(response.headers.get('access-control-allow-origin'), cors['access-control-allow-origin']);
    assert.equal(response.headers.get('x-auth-test'), 'cors-preserved');
    assert.deepEqual(await response.json(), {
      error: 'Server-side lookup is sidecar-only on this deployment.',
      hint: 'Set CRYSTALBALL_APP_KEY server-side and pass X-CrystalBall-Key on the client to enable.',
    });
  });
});

test('app auth preserves 401 missing and invalid versus null exact-key results', async () => {
  await withEnv({ LOCAL_API_PORT: undefined, CRYSTALBALL_APP_KEY: 'app-key-caf\u00e9' }, async () => {
    for (const key of [undefined, '', 'wrong', 'app-key-caf', 'app-key-caf\u00e8']) {
      const response = requireAppAuth(makeRequest({ key }), { 'x-auth-test': 'kept' });
      assert.equal(response.status, 401);
      assert.deepEqual(await response.json(), { error: 'Auth required' });
      assert.equal(response.headers.get('x-auth-test'), 'kept');
    }
    assert.equal(requireAppAuth(makeRequest({ key: 'app-key-caf\u00e9' }), {}), null);
  });
});

test('app auth sidecar bypass follows truthy LOCAL_API_PORT dynamically', async () => {
  await withEnv({ LOCAL_API_PORT: undefined, LOCAL_API_MODE: 'sidecar', CRYSTALBALL_APP_KEY: undefined }, () => {
    const request = makeRequest();
    assert.equal(requireAppAuth(request, {}).status, 403);
    process.env.LOCAL_API_PORT = '0';
    assert.equal(requireAppAuth(request, {}), null);
    process.env.LOCAL_API_PORT = '';
    assert.equal(requireAppAuth(request, {}).status, 403);
    delete process.env.LOCAL_API_PORT;
    assert.equal(requireAppAuth(request, {}).status, 403);
  });
});

test('app auth callsite traverses the full key on exact and first-character-mismatch requests', async () => {
  await withEnv({ LOCAL_API_PORT: undefined, CRYSTALBALL_APP_KEY: 'aapp-secret-token' }, () => {
    const expected = process.env.CRYSTALBALL_APP_KEY;
    for (const key of [expected, 'zapp-secret-token']) {
      // Construct Requests before prototype instrumentation: headers are ByteStrings.
      const request = makeRequest({ key });
      const { result, visits } = observeCodeUnits([key, expected], () => requireAppAuth(request, {}));
      assert.deepEqual(visits, expectedVisits(key, expected));
      assert.equal(result === null, key === expected);
      if (result) assert.equal(result.status, 401);
    }
  });
});

test('API key preserves configured matching and missing or invalid errors', async () => {
  await withEnv({ LOCAL_API_MODE: undefined, CRYSTALBALL_VALID_KEYS: 'alpha,caf\u00e9,,with gap', NODE_ENV: 'production' }, async () => {
    const validate = await loadApiKey();
    for (const key of ['alpha', 'caf\u00e9', 'with gap']) {
      assert.deepEqual(validate(makeRequest({ key })), { valid: true, required: true });
    }
    for (const key of [undefined, '']) {
      assert.deepEqual(validate(makeRequest({ key })), { valid: false, required: true, error: 'API key required' });
    }
    for (const key of ['alph', 'caf\u00e8', 'wrong']) {
      assert.deepEqual(validate(makeRequest({ key })), { valid: false, required: true, error: 'Invalid API key' });
    }
    process.env.CRYSTALBALL_VALID_KEYS = '';
    assert.deepEqual(validate(makeRequest({ key: 'alpha' })), { valid: false, required: true, error: 'Invalid API key' });
  });
});

test('API key preserves trusted-browser GET HEAD OPTIONS exemptions and supplied-key rejection', async () => {
  await withEnv({ LOCAL_API_MODE: undefined, CRYSTALBALL_VALID_KEYS: 'browser-key', NODE_ENV: 'production' }, async () => {
    const validate = await loadApiKey();
    const browser = { origin: 'https://crystalball.app', site: 'same-origin', mode: 'cors' };
    for (const method of ['GET', 'HEAD', 'OPTIONS']) {
      assert.deepEqual(validate(makeRequest({ ...browser, method })), { valid: true, required: false });
      assert.deepEqual(validate(makeRequest({ ...browser, method, key: 'browser-key' })), { valid: true, required: false });
      assert.deepEqual(validate(makeRequest({ ...browser, method, key: 'wrong' })), { valid: false, required: true, error: 'Invalid API key' });
    }
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      assert.deepEqual(validate(makeRequest({ ...browser, method })), {
        valid: false, required: true, error: 'API key required for trusted browser non-read requests',
      });
      assert.deepEqual(validate(makeRequest({ ...browser, method, key: 'browser-key' })), { valid: true, required: true });
    }
  });
});

test('API key preserves exact desktop origin rules and desktop-key requirement', async () => {
  await withEnv({ LOCAL_API_MODE: undefined, CRYSTALBALL_VALID_KEYS: 'desktop-key', NODE_ENV: 'production' }, async () => {
    const validate = await loadApiKey();
    const desktopOrigins = [
      'http://tauri.localhost', 'https://tauri.localhost:1420', 'http://main.tauri.localhost:1420',
      'https://UPPER-CASE.tauri.localhost', 'tauri://localhost', 'asset://localhost',
    ];
    for (const origin of desktopOrigins) {
      assert.deepEqual(validate(makeRequest({ origin })), {
        valid: false, required: true, error: 'API key required for desktop access',
      });
      assert.deepEqual(validate(makeRequest({ origin, key: 'wrong' })), { valid: false, required: true, error: 'Invalid API key' });
      assert.deepEqual(validate(makeRequest({ origin, key: 'desktop-key' })), { valid: true, required: true });
    }
    for (const origin of ['tauri://localhost:1420', 'asset://localhost/path', 'https://tauri.localhost.evil', 'https://a.b.tauri.localhost']) {
      assert.deepEqual(validate(makeRequest({ origin })), { valid: false, required: true, error: 'API key required' });
    }
  });
});

test('API key preserves exact trusted-browser origin allowlist and production loopback rejection', async () => {
  await withEnv({ LOCAL_API_MODE: undefined, CRYSTALBALL_VALID_KEYS: 'valid-key', NODE_ENV: 'production' }, async () => {
    const validate = await loadApiKey();
    const allowed = [
      'https://crystalball.app',
      ...['tech', 'finance', 'happy', 'api'].map(subdomain => `https://${subdomain}.crystalball.app`),
      'https://crystalball-pr-42-bradleybond512.vercel.app',
      'https://crystal-ball-pr-42-bradleybond512.vercel.app',
      'https://crystalball-pr-42-elie-abc123.vercel.app',
      'https://crystal-ball-pr-42-elie-abc123.vercel.app',
    ];
    const denied = [
      undefined, 'https://unknown.example', 'http://crystalball.app', 'https://CRYSTALBALL.app',
      'https://crystalball.app:443', 'https://crystalball.app/path', 'https://evil.crystalball.app',
      'https://crystalball.app.evil', 'https://crystalball-pr-42.vercel.app',
      'https://crystalball-pr-42-bradleybond512.vercel.app.evil',
      'https://crystal-ball-pr-42-elie-.vercel.app', 'https://crystalball-pr-42-elie-abc-123.vercel.app',
      'http://localhost:5173', 'https://127.0.0.1:5173',
    ];
    for (const origin of allowed) {
      assert.deepEqual(validate(makeRequest({ origin, site: 'same-site', mode: 'cors' })), { valid: true, required: false }, origin);
    }
    for (const origin of denied) {
      assert.deepEqual(validate(makeRequest({ origin, site: 'same-site', mode: 'cors' })), {
        valid: false, required: true, error: 'API key required',
      }, origin);
      assert.deepEqual(validate(makeRequest({ origin, key: 'valid-key' })), { valid: true, required: true });
    }
  });
});

test('API key preserves fetch-metadata rules and import-captured development loopback allowance', async () => {
  await withEnv({ LOCAL_API_MODE: undefined, CRYSTALBALL_VALID_KEYS: '', NODE_ENV: 'development' }, async () => {
    const validate = await loadApiKey();
    for (const origin of ['http://localhost:5173', 'https://127.0.0.1:5173']) {
      assert.deepEqual(validate(makeRequest({ origin, site: 'same-site', mode: 'cors' })), { valid: true, required: false });
    }
    process.env.NODE_ENV = 'production';
    assert.deepEqual(validate(makeRequest({ origin: 'http://localhost:5173', site: 'same-site' })), { valid: true, required: false });
    const origin = 'https://crystalball.app';
    for (const site of ['same-origin', 'same-site', 'SAME-SITE']) {
      for (const mode of [undefined, 'cors', 'same-origin', 'navigate', 'no-cors', 'CORS']) {
        assert.deepEqual(validate(makeRequest({ origin, site, mode })), { valid: true, required: false });
      }
    }
    for (const metadata of [{}, { site: 'cross-site' }, { site: 'none' }, { site: 'same-origin', mode: 'websocket' }]) {
      assert.deepEqual(validate(makeRequest({ origin, ...metadata })), { valid: false, required: true, error: 'API key required' });
    }
  });
});

test('API key preserves import-captured sidecar substring policy independently of LOCAL_API_PORT', async () => {
  await withEnv({ LOCAL_API_MODE: 'prefix-sidecar-suffix', LOCAL_API_PORT: undefined, CRYSTALBALL_VALID_KEYS: '', NODE_ENV: 'production' }, async () => {
    const sidecarValidate = await loadApiKey();
    const request = makeRequest({ key: 'invalid', origin: 'https://unknown.example', method: 'POST' });
    assert.deepEqual(sidecarValidate(request), { valid: true, required: false });
    delete process.env.LOCAL_API_MODE;
    assert.deepEqual(sidecarValidate(request), { valid: true, required: false });
    const cloudValidate = await loadApiKey();
    process.env.LOCAL_API_MODE = 'sidecar';
    process.env.LOCAL_API_PORT = '3000';
    assert.deepEqual(cloudValidate(request), { valid: false, required: true, error: 'Invalid API key' });
    process.env.LOCAL_API_MODE = 'SIDECAR';
    const uppercaseValidate = await loadApiKey();
    assert.deepEqual(uppercaseValidate(makeRequest()), { valid: false, required: true, error: 'API key required' });
  });
});

test('API key required-key callsite compares every distinct configured entry after a match', async () => {
  await withEnv({ LOCAL_API_MODE: undefined, CRYSTALBALL_VALID_KEYS: 'first-match-key,,second-key,third-key,first-match-key', NODE_ENV: 'production' }, async () => {
    const validate = await loadApiKey();
    const entries = ['first-match-key', 'second-key', 'third-key'];
    const key = entries[0];
    const request = makeRequest({ key, origin: 'tauri://localhost' });
    const { result, visits } = observeCodeUnits(entries, () => validate(request));
    assert.deepEqual(result, { valid: true, required: true });
    assert.deepEqual(visits, entries.flatMap(entry => expectedVisits(entry, key)));
  });
});

test('API key trusted-read callsite compares every configured entry and keeps spaces literal', async () => {
  await withEnv({ LOCAL_API_MODE: undefined, CRYSTALBALL_VALID_KEYS: 'browser-match-key, padded-key ,last-key', NODE_ENV: 'production' }, async () => {
    const validate = await loadApiKey();
    const entries = ['browser-match-key', ' padded-key ', 'last-key'];
    const browser = { origin: 'https://crystalball.app', site: 'same-origin', mode: 'cors' };
    for (const key of [entries[0], 'wrong-first-char']) {
      const request = makeRequest({ ...browser, key });
      const { result, visits } = observeCodeUnits([...entries, key], () => validate(request));
      assert.deepEqual(visits, entries.flatMap(entry => expectedVisits(entry, key)));
      assert.deepEqual(result, key === entries[0]
        ? { valid: true, required: false }
        : { valid: false, required: true, error: 'Invalid API key' });
    }
    assert.deepEqual(validate(makeRequest({ ...browser, key: 'padded-key' })), {
      valid: false, required: true, error: 'Invalid API key',
    });
  });
});
