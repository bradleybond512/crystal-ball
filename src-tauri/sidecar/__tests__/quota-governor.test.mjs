// R4-BUG-005 step 2: the Quota Governor counts governed calls before they are
// sent, keeps counts across restarts, and honors provider signals. Pure unit
// tests with an injected clock and temp files; nothing touches the network.
import { strict as assert } from 'node:assert';
import test from 'node:test';
import { chmodSync, existsSync, lstatSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  QUOTA_LEDGER_FILE,
  QuotaExhaustedError,
  createQuotaGovernor,
  isQuotaExhausted,
  parseRateLimitReset,
  parseRetryAfter,
} from '../quota-governor.mjs';
import { QUOTA_RULES, openskyStatesCost } from '../quota-policy.mjs';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const T0 = Date.UTC(2026, 9, 1, 12, 0, 0);
const quiet = { warn() {}, log() {} };

const ABUSE = 'https://api.abuseipdb.com/api/v2/blacklist?limit=50';
const GREY = 'https://api.greynoise.io/v3/community/1.2.3.4';
const VT = 'https://www.virustotal.com/api/v3/domains/example.com';
const OPENSKY = 'https://opensky-network.org/api/states/all';
const PURPLE = 'https://api.purpleair.com/v1/sensors?fields=sensor_index%2Cpm2.5%2Clatitude&location_type=0';
const ANTHROPIC = 'https://api.anthropic.com/v1/messages';

function clock(start = T0) {
  let t = start;
  return { now: () => t, advance(ms) { t += ms; }, set(v) { t = v; } };
}

function governor(c, extra = {}) {
  return createQuotaGovernor({ now: c.now, logger: quiet, ...extra });
}

function headers(map) {
  const lower = Object.fromEntries(Object.entries(map).map(([k, v]) => [k.toLowerCase(), v]));
  return { get: (k) => lower[k.toLowerCase()] ?? null };
}

function provider(g, id) {
  return g.status().providers.find((p) => p.id === id);
}

function tempDir(t) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cb-quota-gov-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('background calls stop at 80% of a limit; the reserve stays open to interactive calls', () => {
  const c = clock();
  const g = governor(c);
  for (let i = 0; i < 4; i += 1) assert.equal(g.admit(ABUSE).allowed, true, `call ${i + 1}`);
  const denied = g.admit(ABUSE);
  assert.equal(denied.allowed, false);
  assert.equal(denied.reason, 'budget');
  assert.equal(denied.ruleId, 'abuseipdb-blacklist');
  assert.ok(denied.retryAt > c.now() + 23 * HOUR && denied.retryAt <= c.now() + DAY + MIN, 'frees when the oldest call leaves the rolling day');
  assert.equal(g.admit(ABUSE, { priority: 'interactive' }).allowed, true, 'interactive: counted, never blocked');
  assert.equal(provider(g, 'abuseipdb-blacklist').windows[0].used, 5);
  assert.equal(provider(g, 'abuseipdb-blacklist').state, 'background_paused');
  assert.equal(g.blockedUntil('abuseipdb-blacklist'), denied.retryAt);
  assert.equal(g.blockedUntil('greynoise', 20), null, 'other providers are untouched');
  assert.equal(g.blockedUntil('greynoise', 41), c.now() + 7 * DAY, 'a refresh bigger than the ceiling never fits');
});

test('windows roll: a day later the budget is back', () => {
  const c = clock();
  const g = governor(c);
  for (let i = 0; i < 4; i += 1) g.admit(ABUSE);
  assert.equal(g.admit(ABUSE).allowed, false);
  c.advance(DAY + 2 * MIN);
  assert.equal(g.admit(ABUSE).allowed, true);
  assert.equal(provider(g, 'abuseipdb-blacklist').windows[0].used, 1);
});

test('every window counts: VirusTotal 4/min stops background at 3 a minute', () => {
  const c = clock();
  const g = governor(c);
  for (let i = 0; i < 3; i += 1) assert.equal(g.admit(VT).allowed, true);
  const denied = g.admit(VT);
  assert.equal(denied.allowed, false);
  assert.ok(denied.retryAt - c.now() <= 2 * MIN, 'the minute window frees first');
  c.advance(2 * MIN);
  assert.equal(g.admit(VT).allowed, true);
  assert.deepEqual(provider(g, 'virustotal').windows.map((w) => w.used), [4, 1]);
});

test('OpenSky credits follow the box area', () => {
  const box = (lamin, lamax, lomin, lomax) => new URL(`${OPENSKY}?lamin=${lamin}&lamax=${lamax}&lomin=${lomin}&lomax=${lomax}`);
  assert.equal(openskyStatesCost(new URL(OPENSKY)), 4);
  assert.equal(openskyStatesCost(box(40, 45, -90, -85)), 1);
  assert.equal(openskyStatesCost(box(40, 50, -90, -80)), 2);
  assert.equal(openskyStatesCost(box(30, 50, -100, -80)), 3);
  assert.equal(openskyStatesCost(box(0, 50, -100, 0)), 4);
  assert.equal(openskyStatesCost(box(45, 40, -90, -85)), 4, 'an inverted box is not cheap');
  assert.equal(openskyStatesCost(new URL(`${OPENSKY}?lamin=40&lamax=45`)), 4, 'a partial box is global');
  const g = governor(clock());
  g.admit(OPENSKY);
  g.admit(box(40, 45, -90, -85));
  assert.equal(provider(g, 'opensky-states').windows[0].used, 5);
});

test('pacing doubles the refresh interval once background use reaches 80% of its ceiling', () => {
  const c = clock();
  const g = governor(c);
  assert.equal(g.ttlFor('newsapi', 20 * MIN), 20 * MIN);
  for (let i = 0; i < 64; i += 1) g.admit('https://newsapi.org/v2/everything?q=x');
  assert.equal(provider(g, 'newsapi').state, 'paced');
  assert.equal(g.ttlFor('newsapi', 20 * MIN), 40 * MIN);
  assert.equal(g.ttlFor('unknown-rule', 5), 5);
});

test('provider headers: Retry-After seconds or date, OpenSky retry, AbuseIPDB reset, remaining 0', () => {
  const now = T0;
  assert.equal(parseRetryAfter('120', now), now + 120_000);
  assert.equal(parseRetryAfter(new Date(now + 5 * MIN).toUTCString(), now), Math.floor((now + 5 * MIN) / 1000) * 1000);
  assert.equal(parseRetryAfter('soon', now), null);
  assert.equal(parseRetryAfter('2026', now), now + 2026 * 1000, 'digits are seconds, never a year');
  assert.equal(parseRateLimitReset(String((now + HOUR) / 1000), now), now + HOUR);
  assert.equal(parseRateLimitReset(String(now + HOUR), now), now + HOUR);
  assert.equal(parseRateLimitReset('30', now), now + 30_000);
  assert.equal(parseRateLimitReset('-1', now), null);

  const cases = [
    [{ 'Retry-After': '600' }, 429, 10 * MIN, 'provider_429'],
    [{ 'X-Rate-Limit-Retry-After-Seconds': '900' }, 429, 15 * MIN, 'provider_429'],
    [{ 'X-RateLimit-Reset': String((T0 + 2 * HOUR) / 1000) }, 429, 2 * HOUR, 'provider_429'],
    [{ 'X-Rate-Limit-Remaining': '0', 'Retry-After': '300' }, 200, 5 * MIN, 'provider_remaining_0'],
    [{}, 429, HOUR, 'provider_429'],
    [{}, 402, HOUR, 'provider_out_of_credit'],
  ];
  for (const [hdrs, status, wait, reason] of cases) {
    const c = clock();
    const g = governor(c);
    const ticket = g.admit(OPENSKY);
    g.observe(ticket, { status, headers: headers(hdrs) });
    const p = provider(g, 'opensky-states');
    assert.equal(p.state, 'cooldown', JSON.stringify(hdrs));
    assert.equal(p.cooldownUntil - c.now(), wait, JSON.stringify(hdrs));
    assert.equal(p.cooldownReason, reason);
    const denied = g.admit(OPENSKY);
    assert.equal(denied.reason, 'cooldown');
    assert.equal(denied.retryAt, p.cooldownUntil);
    assert.equal(g.admit(OPENSKY, { priority: 'interactive' }).allowed, true, 'interactive ignores the cooldown');
  }
});

test('remaining credits are recorded, and a cooldown is clamped to [1 min, the window]', () => {
  const c = clock();
  const g = governor(c);
  g.observe(g.admit(OPENSKY), { status: 200, headers: headers({ 'X-Rate-Limit-Remaining': '3120' }) });
  assert.deepEqual(provider(g, 'opensky-states').providerRemaining, { value: 3120, at: T0 });
  assert.equal(provider(g, 'opensky-states').state, 'ok');
  g.observe(g.admit(ABUSE), { status: 429, headers: headers({ 'Retry-After': String(30 * 24 * 3600) }) });
  assert.equal(provider(g, 'abuseipdb-blacklist').cooldownUntil - c.now(), DAY, 'a 30-day header cannot outlast the daily window');
  g.observe(g.admit(VT), { status: 429, headers: headers({ 'Retry-After': '1' }) });
  assert.equal(provider(g, 'virustotal').cooldownUntil - c.now(), MIN, 'at least a minute');
});

test('a changed key clears the provider signals but keeps the counts', () => {
  const c = clock();
  const g = governor(c);
  g.observe(g.admit(GREY), { status: 429, headers: headers({}) });
  assert.equal(provider(g, 'greynoise').state, 'cooldown');
  assert.equal(g.resetSignalsForSecret('GREYNOISE_API_KEY'), true);
  const p = provider(g, 'greynoise');
  assert.equal(p.state, 'ok');
  assert.equal(p.windows[0].used, 1);
  assert.equal(g.resetSignalsForSecret('UNRELATED_KEY'), false);
});

test('a non-governed https host that says 429 + Retry-After is left alone briefly', () => {
  const c = clock();
  const g = governor(c);
  const url = 'https://api.example.test/feed';
  g.observe(g.admit(url), { status: 429, headers: headers({}) });
  assert.equal(g.admit(url).allowed, true, 'no Retry-After: nothing to honor');
  g.observe(g.admit(url), { status: 429, headers: headers({ 'Retry-After': String(24 * 3600) }) });
  const denied = g.admit(url);
  assert.equal(denied.allowed, false);
  assert.equal(denied.retryAt - c.now(), HOUR, 'capped at an hour');
  assert.equal(g.admit(url, { priority: 'interactive' }).allowed, true);
  assert.equal(g.admit('http://api.example.test/feed').allowed, true, 'plain http (loopback) is never paused');
  assert.deepEqual(g.status().throttledHosts, [{ host: 'api.example.test', until: c.now() + HOUR }]);
  c.advance(HOUR + 1);
  assert.equal(g.admit(url).allowed, true);
});

test('PurpleAir points are an estimate that settles to the rows returned', () => {
  const g = governor(clock());
  const first = g.admit(PURPLE);
  assert.equal(first.cost, 3, '3 fields x 1 row before anything is known');
  assert.equal(g.wantsBody(first), true);
  g.observe(first, { status: 200, headers: headers({}), bodyText: JSON.stringify({ data: [[1], [2], [3], [4]] }) });
  assert.equal(provider(g, 'purpleair').windows[0].used, 12);
  assert.equal(g.admit(PURPLE).cost, 12, 'the next estimate uses the last row count');
  const p = provider(g, 'purpleair');
  assert.equal(p.estimate, true);
  assert.equal(p.observeOnly, true, 'no app cap (Bradley)');
  assert.equal(g.blockedUntil('purpleair', 1e6), null);
});

test('Anthropic is observed only: requests and tokens are tallied, never blocked', () => {
  const g = governor(clock());
  for (let i = 0; i < 50; i += 1) {
    const ticket = g.admit(ANTHROPIC);
    assert.equal(ticket.allowed, true);
    g.observe(ticket, { status: 200, headers: headers({}), bodyText: JSON.stringify({ usage: { input_tokens: 120, output_tokens: 30 } }) });
  }
  g.observe(g.admit(ANTHROPIC), { status: 200, headers: headers({}), bodyText: '{"usage":{"input_tokens":-5,"output_tokens":40}}' });
  g.observe(g.admit(ANTHROPIC), { status: 200, headers: headers({}), bodyText: '{"usage":{"input_tokens":2.5,"output_tokens":"9"}}' });
  const p = provider(g, 'anthropic');
  assert.equal(p.windows[0].used, 52);
  assert.equal(p.tokens, 50 * 150 + 40, 'negative, fractional and string counts add nothing');
  assert.equal(p.observeOnly, true);
  assert.equal(g.wantsBody(g.admit('https://newsapi.org/v2/everything')), false, 'no body read for plain counters');
});

test('counts and cooldowns survive a restart; the ledger is 0600 and holds no URLs', (t) => {
  const dir = tempDir(t);
  const filePath = path.join(dir, QUOTA_LEDGER_FILE);
  const c = clock();
  const first = governor(c, { filePath, writeDelayMs: 60_000 });
  first.admit(ABUSE);
  first.admit(`${GREY}?secret=do-not-store`);
  first.observe(first.admit(GREY), { status: 429, headers: headers({ 'Retry-After': '900' }) });
  assert.equal(existsSync(filePath), false, 'writes are coalesced');
  first.flush();
  assert.equal(lstatSync(filePath).mode & 0o777, 0o600);
  const raw = readFileSync(filePath, 'utf8');
  assert.doesNotMatch(raw, /https?:|do-not-store|1\.2\.3\.4/);

  c.advance(5 * MIN);
  const second = governor(c, { filePath });
  assert.equal(provider(second, 'abuseipdb-blacklist').windows[0].used, 1);
  assert.equal(provider(second, 'greynoise').windows[0].used, 2);
  assert.equal(provider(second, 'greynoise').state, 'cooldown');
  assert.equal(second.admit(GREY).allowed, false);
});

test('a tampered ledger cannot pin a cooldown, inject future counts or unknown providers', (t) => {
  const dir = tempDir(t);
  const filePath = path.join(dir, QUOTA_LEDGER_FILE);
  writeFileSync(filePath, JSON.stringify({
    version: 1,
    rules: {
      'abuseipdb-blacklist': { windows: [[[T0 + 10 * DAY, 99], [T0 - MIN, 2], ['x', 1], [T0 - 2 * MIN, -4], [T0 - 3 * MIN, 1e12]]], cooldownUntil: T0 + 365 * DAY, cooldownReason: 'x'.repeat(500) },
      'not-a-provider': { windows: [[[T0, 1]]] },
      greynoise: { windows: [[[T0, 1]], [[T0, 1]]] },
    },
    hosts: [['evil host', T0 + DAY], ['api.example.test', T0 + 365 * DAY]],
  }));
  const g = governor(clock(), { filePath });
  const abuse = provider(g, 'abuseipdb-blacklist');
  assert.equal(abuse.windows[0].used, 2, 'only the one valid bucket counts');
  assert.equal(abuse.cooldownUntil, T0 + DAY, 'clamped to the window');
  assert.ok(abuse.cooldownReason.length <= 40);
  assert.equal(provider(g, 'greynoise').windows[0].used, 0, 'wrong window count is ignored');
  assert.equal(g.status().providers.some((p) => p.id === 'not-a-provider'), false);
  assert.deepEqual(g.status().throttledHosts, [{ host: 'api.example.test', until: T0 + HOUR }]);
});

test('unsafe, oversized or malformed ledgers are ignored', (t) => {
  const dir = tempDir(t);
  const real = path.join(dir, 'real.json');
  writeFileSync(real, JSON.stringify({ version: 1, rules: { 'abuseipdb-blacklist': { windows: [[[T0, 4]]] } } }));
  const link = path.join(dir, QUOTA_LEDGER_FILE);
  symlinkSync(real, link);
  assert.equal(provider(governor(clock(), { filePath: link }), 'abuseipdb-blacklist').windows[0].used, 0, 'symlink');
  assert.equal(provider(governor(clock(), { filePath: real, maxBytes: 10 }), 'abuseipdb-blacklist').windows[0].used, 0, 'oversized');
  const bad = path.join(dir, 'bad.json');
  writeFileSync(bad, '{"version":1,');
  chmodSync(bad, 0o600);
  assert.equal(provider(governor(clock(), { filePath: bad }), 'abuseipdb-blacklist').windows[0].used, 0, 'malformed');
  writeFileSync(bad, JSON.stringify({ version: 2, rules: { 'abuseipdb-blacklist': { windows: [[[T0, 4]]] } } }));
  assert.equal(provider(governor(clock(), { filePath: bad }), 'abuseipdb-blacklist').windows[0].used, 0, 'unknown version');
});

test('the quota error is recognizable and carries the provider and retry time', () => {
  const error = new QuotaExhaustedError({ ruleId: 'newsapi', reason: 'budget', retryAt: T0 + HOUR });
  assert.equal(isQuotaExhausted(error), true);
  assert.equal(error.provider, 'newsapi');
  assert.equal(error.retryAt, T0 + HOUR);
  assert.equal(isQuotaExhausted(new Error('x')), false);
});

test('status lists every rule with limits and ceilings, and no secrets', () => {
  const g = governor(clock());
  const status = g.status();
  assert.deepEqual(status.providers.map((p) => p.id), QUOTA_RULES.map((r) => r.id));
  assert.equal(status.targetShare, 0.8);
  const vt = provider(g, 'virustotal');
  assert.deepEqual(vt.windows.map((w) => [w.limit, w.backgroundCeiling]), [[500, 400], [4, 3]]);
  assert.doesNotMatch(JSON.stringify(status), /API_KEY|https?:/);
});
