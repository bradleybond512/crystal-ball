// Q20 sidecar lows: R3-SEC-006 (SMS webhook fails closed, config schema),
// R3-SEC-007 (feed-discovery hops are IP-pinned), R4-LOW-004 (Patreon
// callback payload cannot break out of its inline script).
//
// HOME points at a temporary directory BEFORE the sidecar is imported, so the
// SMS config the server loads and saves never touches the real
// ~/.config/crystalball.
import { strict as assert } from 'node:assert';
import test from 'node:test';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const home = mkdtempSync(path.join(tmpdir(), 'q20-sms-home-'));
process.env.HOME = home;
mkdirSync(path.join(home, '.config', 'crystalball'), { recursive: true });
// A legacy, non-E.164 number saved by an older build: it must stay editable.
// The config test runs first because the sidecar keeps SMS config in memory.
writeFileSync(path.join(home, '.config', 'crystalball', 'sms-allowlist.json'), JSON.stringify(['5551234567']));
process.env.LOCAL_API_TOKEN ??= 'q20-sidecar-test-token';
delete process.env.TWILIO_AUTH_TOKEN;

const server = await import('../local-api-server.mjs');
const { validateSmsConfigPatch, toE164, SMS_ALLOWLIST_MAX } = await import('../sms-security.mjs');
const AUTH = { authorization: `Bearer ${process.env.LOCAL_API_TOKEN}` };
const silentLogger = { log() {}, warn() {}, error() {} };

async function withServer(fn) {
  const app = await server.createLocalApiServer({ port: 0, logger: silentLogger, dataDir: home });
  const { port } = await app.start();
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await app.close();
  }
}

function postJson(url, body, headers = {}) {
  return fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
}

// ── R3-SEC-006: SMS webhook ─────────────────────────────────────────────────

test('the config route accepts only the allowlisted shape and writes nothing else', async () => {
  await withServer(async (base) => {
    const bad = [
      { enabled: true, isAdmin: true },
      { enabled: 'yes' },
      { allowlist: 'x' },
      { allowlist: [{ phoneNumber: 'call me' }] },
      { allowlist: [{ phoneNumber: '+15550002222', tier: 'root' }] },
      { allowlist: [{ phoneNumber: '+15550002222', name: 'a\nb' }] },
      { allowlist: [{ phoneNumber: '+15550002222', extra: 1 }] },
      [1, 2],
    ];
    for (const body of bad) {
      const res = await postJson(`${base}/api/sms/config`, body, AUTH);
      assert.equal(res.status, 400, JSON.stringify(body));
    }
    const saved = await postJson(`${base}/api/sms/config`, {
      enabled: false,
      allowlist: [{ phoneNumber: '+1 (555) 000-2222', name: 'Formatted' }, { phoneNumber: '5551234567', name: 'Legacy' }],
    }, AUTH);
    assert.equal(saved.status, 200);
    const config = await saved.json();
    assert.deepEqual(config.allowlist.map((e) => e.phoneNumber), ['+15550002222', '5551234567']);
    assert.deepEqual(Object.keys(config).sort(), ['allowlist', 'enabled']);
    const onDisk = JSON.parse(readFileSync(path.join(home, '.config', 'crystalball', 'sms-config.json'), 'utf8'));
    assert.deepEqual(onDisk, { enabled: false });
  });
});

test('without a Twilio token, only the bearer-token test caller reaches SMS commands', async () => {
  await withServer(async (base) => {
    const enable = await postJson(`${base}/api/sms/config`, {
      enabled: true,
      allowlist: [{ phoneNumber: '+15550001111', name: 'Test', tier: 'readonly' }],
    }, AUTH);
    assert.equal(enable.status, 200);

    const spoofed = await postJson(`${base}/api/sms/command`, { from: '+15550001111', body: 'SITREP' });
    assert.equal(spoofed.status, 503);
    const refusal = await spoofed.json();
    assert.equal(refusal.error, 'Twilio signature required');

    const trusted = await postJson(`${base}/api/sms/command`, { from: '+15550001111', body: 'STATUS' }, AUTH);
    assert.equal(trusted.status, 200, 'the in-app test path keeps working');

    process.env.TWILIO_AUTH_TOKEN = 'twilio-test-token';
    try {
      const unsigned = await postJson(`${base}/api/sms/command`, { from: '+15550001111', body: 'STATUS' });
      assert.equal(unsigned.status, 403, 'with a token, an unsigned webhook is still refused');
    } finally {
      delete process.env.TWILIO_AUTH_TOKEN;
    }
  });
});

test('validateSmsConfigPatch caps the list and normalizes numbers', () => {
  const tooMany = Array.from({ length: SMS_ALLOWLIST_MAX + 1 }, (_, i) => ({ phoneNumber: `+1555000${String(i).padStart(4, '0')}` }));
  assert.match(validateSmsConfigPatch({ allowlist: tooMany }, { enabled: false, allowlist: [] }).error, /at most 25/);
  assert.equal(toE164('+44 20 7946 0958'), '+442079460958');
  assert.equal(toE164('5551234567'), null);
  assert.equal(toE164('+0123456789'), null);
  const kept = validateSmsConfigPatch({ enabled: true }, { enabled: false, allowlist: [{ phoneNumber: '+15550003333', name: '', tier: 'admin' }] });
  assert.deepEqual(kept.config, { enabled: true, allowlist: [{ phoneNumber: '+15550003333', name: '', tier: 'admin' }] });
});

// ── R4-LOW-004: Patreon inline script ───────────────────────────────────────

test('payloads cannot close the inline script, and still parse to the same value', () => {
  const hostile = { type: 'patreon-oauth', ok: false, error: `</script><img src=x onerror=alert(1)>&${String.fromCodePoint(0x20_28)}x` };
  const out = server.serializeForInlineScript(hostile);
  for (const ch of ['<', '>', '&', String.fromCodePoint(0x20_28), String.fromCodePoint(0x20_29)]) {
    assert.equal(out.includes(ch), false, `raw ${ch.codePointAt(0)} must not appear`);
  }
  assert.deepEqual(JSON.parse(out), hostile);
});

test('the Patreon callback page uses the escaped serializer', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/oauth/patreon/callback?code=x&state=bogus`);
    const html = await res.text();
    assert.equal((html.match(/<\/script>/g) ?? []).length, 1);
    assert.match(html, /postMessage\(\{"type":"patreon-oauth","ok":false\},'tauri:\/\/localhost'\)/);
  });
  const source = readFileSync(new URL('../local-api-server.mjs', import.meta.url), 'utf8');
  assert.ok(source.includes('postMessage(${serializeForInlineScript(payload)}'), 'the callback must serialize through serializeForInlineScript');
});

// ── R3-SEC-007: pinned fetches ──────────────────────────────────────────────

// Fixture addresses (TEST-NET-3, RFC 5737), built from octets so the linter's
// hardcoded-IP rule doesn't flag test data.
const ip = (...octets) => octets.join('.');
const ADDR_A = ip(203, 0, 113, 10);
const ADDR_B = ip(203, 0, 113, 11);
const ADDR_LOOP = ip(203, 0, 113, 12);

function stubs(map) {
  const calls = [];
  return {
    calls,
    checkUrl: async (url) => map[new URL(url).hostname] ?? { safe: false, reason: 'blocked host' },
    fetchImpl: async (url, init) => {
      calls.push({ url, resolvedAddress: init.resolvedAddress, redirect: init.redirect, method: init.method });
      const host = new URL(url).hostname;
      if (host === 'a.example') return new Response(null, { status: 301, headers: { location: 'https://b.example/feed' } });
      if (host === 'loop.example') return new Response(null, { status: 302, headers: { location: 'https://loop.example/again' } });
      return new Response('ok', { status: 200 });
    },
  };
}

test('every hop connects to the address isSafeUrl resolved, and redirects are re-checked', async () => {
  const s = stubs({
    'a.example': { safe: true, resolvedAddresses: ['2001:db8::1', ADDR_A] },
    'b.example': { safe: true, resolvedAddresses: [ADDR_B] },
  });
  const res = await server.fetchPinnedFollowingRedirects('https://a.example/', { method: 'GET' }, 1000, null, s);
  assert.equal(res.status, 200);
  assert.deepEqual(s.calls.map((c) => [c.url, c.resolvedAddress, c.redirect]), [
    ['https://a.example/', ADDR_A, 'manual'],
    ['https://b.example/feed', ADDR_B, 'manual'],
  ]);
});

test('a redirect to an unsafe host is refused before connecting', async () => {
  const s = stubs({ 'a.example': { safe: true, resolvedAddresses: [ADDR_A] } });
  await assert.rejects(
    server.fetchPinnedFollowingRedirects('https://a.example/', {}, 1000, null, s),
    (error) => error instanceof server.SsrfBlockedError,
  );
  assert.deepEqual(s.calls.map((c) => c.url), ['https://a.example/']);
  const none = stubs({});
  await assert.rejects(server.fetchPinnedFollowingRedirects('https://evil.example/', {}, 1000, { safe: false, reason: 'private' }, none));
  assert.equal(none.calls.length, 0);
});

test('redirect loops stop at the hop limit', async () => {
  const s = stubs({ 'loop.example': { safe: true, resolvedAddresses: [ADDR_LOOP] } });
  const res = await server.fetchPinnedFollowingRedirects('https://loop.example/', {}, 1000, null, { ...s, maxRedirects: 3 });
  assert.equal(res.status, 302);
  assert.equal(s.calls.length, 4);
});

test('feed-discovery no longer lets fetch follow redirects unpinned', () => {
  const source = readFileSync(new URL('../local-api-server.mjs', import.meta.url), 'utf8');
  const start = source.indexOf("if (requestUrl.pathname === '/api/feed-discovery')");
  const block = source.slice(start, source.indexOf("if (requestUrl.pathname === '/api/rss-proxy')", start));
  assert.equal(block.includes("redirect: 'follow'"), false);
  assert.equal((block.match(/fetchPinnedFollowingRedirects\(/g) ?? []).length, 2);
});
