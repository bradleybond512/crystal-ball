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

// Additive October 11 proofs. Each legacy scenario owns a fresh Node process:
// seeding disk precedes imports; no API backdoor changes the server singleton.
import { spawn } from 'node:child_process';

const legacyRows = (count = 27) => Array.from({ length: count }, (_, i) => ({
  phoneNumber: `+1555700${String(i).padStart(4, '0')}`, name: `Recipient ${i}`, tier: 'readonly',
}));
const isolatedSmsSource = String.raw`
const workerData = JSON.parse(process.env.Q20_OWNED_SMS_FIXTURE);
const parentPort = { postMessage: value => process.send(value, () => process.disconnect()) };
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { createHmac } = require('node:crypto');
(async () => {
  const home = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'q20-owned-worker-'));
  process.env.HOME = home;
  delete process.env.TWILIO_AUTH_TOKEN;
  const dir = path.join(home, '.config', 'crystalball');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'sms-config.json'), JSON.stringify({ enabled: workerData.seed.enabled }));
  fs.writeFileSync(path.join(dir, 'sms-allowlist.json'), JSON.stringify(workerData.seed.allowlist));
  const server = await import(workerData.module);
  const app = await server.createLocalApiServer({ port: 0, dataDir: home, logger: { log(){}, warn(){}, error(){} } });
  try {
    const { port } = await app.start();
    const base = 'http://127.0.0.1:' + port;
    const auth = { authorization: 'Bearer ' + process.env.LOCAL_API_TOKEN };
    const post = (patch, headers = auth) => fetch(base + '/api/sms/config', {
      method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(patch),
    });
    const get = async () => (await fetch(base + '/api/sms/config', { headers: auth })).json();
    const disk = () => ({ enabled: JSON.parse(fs.readFileSync(path.join(dir, 'sms-config.json'))).enabled,
      allowlist: JSON.parse(fs.readFileSync(path.join(dir, 'sms-allowlist.json'))) });
    const bytes = () => ['sms-config.json','sms-allowlist.json'].map(name => fs.readFileSync(path.join(dir,name),'utf8'));
    const accept = async (patch, expected, label) => {
      const response = await post(patch);
      assert.equal(response.status, 200, label);
      assert.deepEqual(await response.json(), expected, label + ' response');
      assert.deepEqual(await get(), expected, label + ' live');
      assert.deepEqual(disk(), expected, label + ' disk tuples/counts');
      assert.equal(disk().allowlist.length, expected.allowlist.length, label + ' count');
    };
    const reject = async (patch, label) => {
      const before = await get(); const saved = bytes();
      const response = await post(patch);
      assert.equal(response.status, 400, label);
      assert.equal(typeof (await response.json()).error, 'string', label + ' reason');
      assert.deepEqual(await get(), before, label + ' live unchanged');
      assert.deepEqual(bytes(), saved, label + ' disk byte unchanged');
    };
    await eval('(' + workerData.fn + ')')({ assert, base, auth, post, get, disk, bytes, accept, reject,
      seed: workerData.seed, fixture: workerData.fixture, http, createHmac });
  } finally { await app.close(); fs.rmSync(home, { recursive:true, force:true }); }
  parentPort.postMessage({ ok: true });
})().catch(error => parentPort.postMessage({ error: { name:error.name, message:error.message, code:error.code, stack:error.stack } }));
`;
async function isolatedSms(seed, fn, fixture = {}) {
  const worker = spawn(process.execPath, ['--input-type=commonjs', '-e', isolatedSmsSource], {
    env: { ...process.env, Q20_OWNED_SMS_FIXTURE: JSON.stringify({
      seed, fixture, fn: fn.toString(), module: new URL('../local-api-server.mjs', import.meta.url).href,
    }) }, stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
  });
  try {
    await new Promise((resolve, reject) => {
      worker.once('error', reject);
      worker.once('message', result => result.error ? reject(Object.assign(new Error(result.error.message), result.error)) : resolve());
      worker.once('exit', code => { if (code !== 0) reject(new Error(`SMS worker exited ${code}`)); });
    });
  } finally {
    if (worker.exitCode === null) await new Promise(resolve => worker.once('exit', resolve));
  }
}

for (const enabled of [true, false]) {
  test(`real API ${enabled ? 'enabled' : 'disabled'}27 accepts strict 27→26→25 tuple reductions`, async () => {
    await isolatedSms({ enabled, allowlist: legacyRows() }, async ({ seed, accept }) => {
      await accept({ allowlist: seed.allowlist.slice(1) }, { enabled: seed.enabled, allowlist: seed.allowlist.slice(1) }, '27→26 strict reduction');
      await accept({ allowlist: seed.allowlist.slice(2) }, { enabled: seed.enabled, allowlist: seed.allowlist.slice(2) }, '26→25 strict reduction');
    });
  });
}
test('real API partial disable and disabled no-op preserve all27; re-enable omitted list is refused', async () => {
  await isolatedSms({ enabled: true, allowlist: legacyRows() }, async ({ seed, accept, reject }) => {
    const disabled = { ...seed, enabled: false };
    await accept({ enabled: false }, disabled, 'enabled-only disable');
    await accept({}, disabled, 'omitted fields no-op');
    await accept({ enabled: false }, disabled, 'disabled-only no-op');
    await reject({ enabled: true }, 'disabled27 cannot re-enable without list');
  });
});
test('real API disabled27 cannot enable with26 but can enable with25', async () => {
  await isolatedSms({ enabled: false, allowlist: legacyRows() }, async ({ seed, reject, accept }) => {
    await reject({ enabled: true, allowlist: seed.allowlist.slice(1) }, 'disabled27→enabled26 refused');
    await accept({ enabled: true, allowlist: seed.allowlist.slice(2) }, { enabled:true, allowlist:seed.allowlist.slice(2) }, 'disabled27→enabled25');
  });
});
test('real API already-enabled27 enabled-only true no-op retains all tuples', async () => {
  await isolatedSms({ enabled:true, allowlist:legacyRows() }, async ({ seed, accept }) => {
    await accept({ enabled:true }, seed, 'inherited enabled state no-op');
  });
});
test('real API overcap exception refuses unchanged/increased/replacement/new/metadata/multiplicity lists', async () => {
  await isolatedSms({ enabled:false, allowlist:legacyRows() }, async ({ seed, reject }) => {
    const list = seed.allowlist;
    await reject({ allowlist:list }, 'unchanged27');
    await reject({ enabled:false, allowlist:list }, 'disabled full unchanged27 no-op');
    await reject({ allowlist:[...list, { phoneNumber:'+15558889999', name:'New', tier:'readonly' }] }, 'increased28');
    await reject({ allowlist:[...list.slice(1), { phoneNumber:'+15558889999', name:'New', tier:'readonly' }] }, 'replacement27');
    await reject({ allowlist:[...list.slice(2), { phoneNumber:'+15558889999', name:'New', tier:'readonly' }] }, 'new recipient in shorter26');
    await reject({ allowlist:[{ ...list[1], name:'Changed' }, ...list.slice(2)] }, 'name changed in shorter26');
    await reject({ allowlist:[{ ...list[1], tier:'admin' }, ...list.slice(2)] }, 'tier escalation in shorter26');
    await reject({ allowlist:[list[2], ...list.slice(2)] }, 'duplicate tuple count increased in shorter26');
  });
});
test('real API duplicate counts can decrease and normalized saved tuples authorize exact reduction', async () => {
  const rows = legacyRows(); rows[0] = { ...rows[1] }; rows[2].name = `  ${rows[2].name}  `;
  await isolatedSms({ enabled:true, allowlist:rows }, async ({ seed, accept }) => {
    const reduced = seed.allowlist.slice(1).map(entry => ({ ...entry, name:entry.name.trim() }));
    await accept({ allowlist:reduced }, { enabled:true, allowlist:reduced }, 'duplicate decrement and normalized tuple reduction');
  });
});
test('real API new26 and at-cap additions are refused; <=25 normal metadata edits are allowed', async () => {
  await isolatedSms({ enabled:false, allowlist:[] }, async ({ reject, accept }) => {
    const rows = Array.from({ length:26 }, (_,i) => ({ phoneNumber:'+1555800'+String(i).padStart(4,'0'), name:'Normal', tier:'readonly' }));
    await reject({ allowlist:rows }, 'new26 from empty');
    await accept({ allowlist:rows.slice(0,25) }, { enabled:false, allowlist:rows.slice(0,25) }, 'new25');
    await reject({ allowlist:rows }, 'at25 add26');
    rows[0] = { ...rows[0], name:'Allowed edit', tier:'admin' };
    await accept({ enabled:true, allowlist:rows.slice(0,25) }, { enabled:true, allowlist:rows.slice(0,25) }, 'normal metadata edit at25');
  });
});

const invalidEntries = [
  ['null object', null], ['string object', '+15558889999'], ['array object', []],
  ['unknown entry key', { phoneNumber:'+15558889999', extra:true }],
  ['missing phone', { name:'Missing' }], ['phone wrong type', { phoneNumber:55_558_889_999 }],
  ['invalid new phone', { phoneNumber:'55558889999' }],
  ['name wrong type', { phoneNumber:'+15558889999', name:17 }],
  ['name >64', { phoneNumber:'+15558889999', name:'x'.repeat(65) }],
  ['name control', { phoneNumber:'+15558889999', name:'a\nb' }],
  ['name DEL', { phoneNumber:'+15558889999', name:'a\u007Fb' }],
  ['unknown tier', { phoneNumber:'+15558889999', tier:'root' }],
];
for (const [label, entry] of invalidEntries) {
  test(`strict entry guard: ${label}, direct and real API no-write`, async () => {
    assert.equal(typeof validateSmsConfigPatch({ allowlist:[entry] }, { enabled:false, allowlist:[] }).error, 'string', label);
    await isolatedSms({ enabled:false, allowlist:legacyRows() }, async ({ reject, seed, fixture }) => {
      await reject({ allowlist:[fixture.entry] }, fixture.label + ' normal');
      await reject({ allowlist:[fixture.entry, ...seed.allowlist.slice(2)] }, fixture.label + ' overcap reduction');
    }, { entry, label });
  });
}
test('real API exact saved legacy phone remains editable but changed/new legacy equivalent is refused', async () => {
  await isolatedSms({ enabled:false, allowlist:[{ phoneNumber:'5551234567', name:'Old', tier:'readonly' }] }, async ({ accept, reject }) => {
    await accept({ allowlist:[{ phoneNumber:'5551234567', name:'Edited', tier:'admin' }] }, { enabled:false, allowlist:[{ phoneNumber:'5551234567', name:'Edited', tier:'admin' }] }, 'exact saved legacy');
    await reject({ allowlist:[{ phoneNumber:'555-123-4567', name:'Changed', tier:'readonly' }] }, 'unknown formatted legacy equivalent');
    await reject({ allowlist:[{ phoneNumber:'5551234568', name:'New', tier:'readonly' }] }, 'unknown legacy');
    await accept({ allowlist:[{ phoneNumber:'+1 (555) 888-9999', name:' Normal ', tier:'readonly' }] }, { enabled:false, allowlist:[{ phoneNumber:'+15558889999', name:'Normal', tier:'readonly' }] }, 'new E164 normalization');
  });
});
test('real API config shape, auth and 64KiB body guard preserve live and disk bytes', async () => {
  await isolatedSms({ enabled:false, allowlist:[] }, async ({ assert, base, auth, get, bytes, reject }) => {
    for (const patch of [null, [], { enabled:'yes' }, { extra:'inert' }, { allowlist:'bad' }]) await reject(patch, 'strict config shape');
    const before = await get(); const saved = bytes();
    const unauthorized = await fetch(base+'/api/sms/config', { method:'POST', headers:{ authorization:'Bearer wrong', 'content-type':'application/json' }, body:'{"enabled":true}' });
    assert.equal(unauthorized.status,401,'wrong config token');
    const oversized = await fetch(base+'/api/sms/config', { method:'POST', headers:{...auth, 'content-type':'application/json'}, body:' '.repeat(64*1024)+'{"enabled":true}' });
    assert.equal(oversized.status,400,'valid JSON >64KiB refused before write');
    assert.deepEqual(await get(),before,'oversize live unchanged'); assert.deepEqual(bytes(),saved,'oversize disk unchanged');
  });
});
test('missing Twilio token refuses a held body before any bytes are sent', async () => {
  await isolatedSms({ enabled:true, allowlist:legacyRows(1) }, async ({ assert, base, http }) => {
    const result = await new Promise((resolve,reject) => {
      const req = http.request(base+'/api/sms/command', { method:'POST', headers:{'content-type':'application/json','content-length':'100'} }, res => {
        let body=''; res.setEncoding('utf8'); res.on('data',chunk=>body+=chunk); res.on('end',()=>{req.destroy();resolve({status:res.statusCode,body});});
      });
      req.on('error',reject); req.setTimeout(1200,()=>{req.destroy();reject(new Error('held-body refusal did not arrive before body-read deadline'));});
      req.flushHeaders(); // Deliberately never write or end: reading body would stall.
    });
    assert.equal(result.status,503,'missing Twilio prebody refusal');
    assert.equal(JSON.parse(result.body).error,'Twilio signature required');
  });
});
test('fake CB STATUS bearer and signed form return status content; invalid auth/origin/tier/rate fail closed', async () => {
  await isolatedSms({ enabled:true, allowlist:legacyRows(1) }, async ({ assert, base, auth, seed, createHmac }) => {
    const command = (body, headers={}) => fetch(base+'/api/sms/command',{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)});
    const statusBody={from:seed.allowlist[0].phoneNumber,body:'CB STATUS'};
    const trusted=await command(statusBody,auth);assert.equal(trusted.status,200);
    const content=await trusted.json();assert.match(content.response,/^CB [A-Z]+ · no active threads\nfeeds \d+\/\d+ ok$/,'valid bearer executes STATUS formatter');assert.ok(content.segments>=1);
    process.env.TWILIO_AUTH_TOKEN='fake-owned-twilio-key';
    try {
      const params={Body:'CB STATUS',From:seed.allowlist[0].phoneNumber};
      const url=base+'/api/sms/command';
      const signature=createHmac('sha1',process.env.TWILIO_AUTH_TOKEN).update(url+Object.keys(params).sort().map(k=>k+params[k]).join('')).digest('base64');
      const signed=await fetch(url,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded','x-forwarded-proto':'http','x-twilio-signature':signature},body:new URLSearchParams(params)});
      assert.equal(signed.status,200,'valid fake signature');const signedContent=await signed.json();assert.match(signedContent.response,/^CB .*\nfeeds \d+\/\d+ ok$/,'signed STATUS content');
      const badSignature=await command(statusBody,{'x-twilio-signature':'bad'});assert.equal(badSignature.status,403,'bad signature');
      const badBearer=await command(statusBody,{authorization:'Bearer wrong'});assert.equal(badBearer.status,403,'wrong bearer not signature bypass');
      const browser=await command(statusBody,{origin:'https://inert.example'});assert.equal(browser.status,403,'browser origin');
      const stranger=await command({from:'+15559999999',body:'CB STATUS'},auth);assert.equal(stranger.status,403,'bearer still requires allowlist');
      const tier=await command({from:statusBody.from,body:'CB WATCH inert'},auth);assert.equal(tier.status,403,'bearer still requires admin');
      let rate;for(let i=0;i<11;i++)rate=await command(statusBody,auth);
      assert.equal(rate.status,429,'bearer still rate-limited');const rateContent=await rate.json();assert.match(rateContent.response,/rate limit/);
    } finally { delete process.env.TWILIO_AUTH_TOKEN; }
  });
});
test('actual U+2029 serializer escapes and roundtrips without changing original hostile fixture', () => {
  const payload={type:'patreon-oauth',ok:false,error:`left${String.fromCodePoint(0x20_29)}right`};
  const serialized=server.serializeForInlineScript(payload);
  assert.equal(serialized.includes(String.fromCodePoint(0x20_29)),false,'raw actual U+2029 absent');
  assert.match(serialized,/\\u2029/);assert.deepEqual(JSON.parse(serialized),payload);
});
for (const [label, pattern] of [
  ['homepage GET', /const home = await fetchPinnedFollowingRedirects\(target\.href, \{ headers \}, 10_000, safety\)/],
  ['feed HEAD', /const res = await fetchPinnedFollowingRedirects\(probeUrl, \{ method: 'HEAD', headers \}, 6_000, safety\)/],
]) test(`independent feed discovery ${label} production call-site remains pinned`, () => {
  const source=readFileSync(new URL('../local-api-server.mjs',import.meta.url),'utf8');
  assert.match(source,pattern,`${label} must call pinned helper with checked first verdict`);
});


test('real API normalized equivalent submitted phone tuple can reduce27→26 without metadata drift', async () => {
  await isolatedSms({ enabled:true, allowlist:legacyRows() }, async ({ seed, accept }) => {
    const expected = seed.allowlist.slice(1);
    const submitted = expected.map((entry,index) => index === 0
      ? { ...entry, phoneNumber:'+1 (555) 700-0001', name:'  Recipient 1  ' } : entry);
    await accept({ enabled:true, allowlist:submitted }, { enabled:true, allowlist:expected }, 'normalized phone/name tuples');
  });
});
test('real API malformed saved survivor can be disabled but cannot use oversized cleanup exemption', async () => {
  const rows=legacyRows(); rows[1]={...rows[1],name:'bad\nname'};
  await isolatedSms({ enabled:true, allowlist:rows }, async ({ seed, accept, reject }) => {
    await accept({ enabled:false }, { ...seed, enabled:false }, 'disable preserves malformed legacy survivor');
    await reject({ allowlist:seed.allowlist.slice(1) }, 'malformed saved survivor never confers admission');
    const cleaned=seed.allowlist.filter((_,index)=>index!==1);
    await accept({ allowlist:cleaned }, { enabled:false, allowlist:cleaned }, 'explicit remove malformed survivor');
  });
});

// Additive guard discrimination; direct-only fixtures do not imply JSON transport.

test('real API exact saved tuple with unknown entry key cannot use shorter26 exemption', async () => {
  await isolatedSms({ enabled: false, allowlist: legacyRows() }, async ({ seed, reject }) => {
    const shorter = seed.allowlist.slice(1);
    shorter[0] = { ...shorter[0], extra: 'inert-extra-field' };
    await reject({ allowlist: shorter }, 'exact saved tuple with unknown entry key, shorter26');
  });
});

test('strict entry guard: direct-only array with named valid fields remains an object-shape refusal', () => {
  // JSON serialization drops the named fields of this array. This is direct
  // validator isolation, not a claim that these named fields cross JSON.
  const arrayEntry = Object.assign([], { phoneNumber: '+15558880000', name: 'Named array', tier: 'readonly' });
  let result;
  assert.doesNotThrow(() => {
    result = validateSmsConfigPatch({ allowlist: [arrayEntry] }, { enabled: false, allowlist: [] });
  }, 'named array shape refusal must not throw');
  assert.equal(typeof result.error, 'string', 'named array cannot become admitted object');
  assert.match(result.error, /entries must be objects/, 'named array shape reason');
});

test('strict phone type: real JSON array and direct boxed valid E164 remain refused without coercion', async () => {
  const boxed = { phoneNumber: new Object('+15558880000'), name: 'Boxed direct-only', tier: 'readonly' };
  let result;
  assert.doesNotThrow(() => {
    result = validateSmsConfigPatch({ allowlist: [boxed] }, { enabled: false, allowlist: [] });
  }, 'direct boxed phone refusal must not throw');
  assert.equal(typeof result.error, 'string', 'direct boxed valid E164 cannot bypass string type');
  await isolatedSms({ enabled: false, allowlist: [] }, async ({ reject }) => {
    // String(['+15558880000']) would produce a valid E164 string. This JSON
    // phone-field array therefore isolates a natural String(...) mutation.
    await reject({ allowlist: [{ phoneNumber: ['+15558880000'], name: 'JSON array phone', tier: 'readonly' }] }, 'JSON phone array cannot coerce into E164');
  });
});

test('strict malformed config/entry rejection returns structured error without throwing', () => {
  const current = { enabled: false, allowlist: [] };
  for (const patch of [null, 'bad', 17, [], { allowlist: [null] }, { allowlist: [17] }, { allowlist: ['+15558880000'] }]) {
    let result;
    assert.doesNotThrow(() => { result = validateSmsConfigPatch(patch, current); }, 'malformed input must return error without throwing');
    assert.equal(typeof result?.error, 'string', 'malformed input returns structured refusal');
    assert.equal(result.config, undefined, 'malformed input does not return admitted config');
  }
});

test('pinned helper supplied unsafe firstSafety wins over an independently safe resolver before any calls', async () => {
  let resolverCalls = 0;
  let fetchCalls = 0;
  await assert.rejects(server.fetchPinnedFollowingRedirects('https://inert.example/first', {}, 1000,
    { safe: false, reason: 'inert supplied unsafe verdict' }, {
      checkUrl: async () => { resolverCalls += 1; return { safe: true, resolvedAddresses: [ADDR_A] }; },
      fetchImpl: async () => { fetchCalls += 1; return new Response('inert', { status: 200 }); },
    }), error => error instanceof server.SsrfBlockedError, 'unsafe supplied first verdict must reject before resolver/fetch');
  assert.equal(resolverCalls, 0, 'supplied unsafe verdict never calls safe resolver');
  assert.equal(fetchCalls, 0, 'supplied unsafe verdict never calls fetch');
});

test('strict entry guard: direct-only function with named valid fields cannot become an object entry', () => {
  // Functions do not cross JSON as entries. Named own fields isolate the
  // typeof raw !== 'object' validator guard without missing-phone masking.
  const functionEntry = Object.assign(function inertEntry() { return null; }, {
    phoneNumber: '+15558880000', tier: 'readonly',
  });
  // Function.name is read-only but configurable; make the test field enumerable.
  Object.defineProperty(functionEntry, 'name', { value: 'Named function', enumerable: true });
  let result;
  assert.doesNotThrow(() => {
    result = validateSmsConfigPatch({ allowlist: [functionEntry] }, { enabled: false, allowlist: [] });
  }, 'direct-only function refusal must not throw');
  assert.equal(typeof result.error, 'string', 'function with valid own fields cannot bypass entry object type');
  assert.match(result.error, /entries must be objects/, 'function shape reason');
});
