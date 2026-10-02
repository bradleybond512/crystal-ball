// R4-BUG-005 step 2: the API budgets report is validated before rendering,
// and the tab escapes everything the sidecar sends.
import assert from 'node:assert/strict';
import test from 'node:test';

import { fetchQuotaStatus, formatUntil, formatWindow, parseQuotaStatus } from '../quota-budgets.ts';
import { renderQuotaBudgetsHtml } from '../../../components/system-diagnostic-budgets.ts';

const NOW = Date.UTC(2026, 9, 1, 12);
const HOUR = 3_600_000;

function provider(overrides: Record<string, unknown> = {}) {
  return {
    id: 'abuseipdb-blacklist',
    label: 'AbuseIPDB blacklist',
    unit: 'requests',
    estimate: false,
    unverified: false,
    observeOnly: false,
    state: 'background_paused',
    windows: [{ windowMs: 24 * HOUR, limit: 5, backgroundCeiling: 4, used: 4 }],
    cooldownUntil: null,
    cooldownReason: null,
    budgetFreesAt: NOW + 3 * HOUR,
    providerRemaining: null,
    last429At: null,
    ...overrides,
  };
}

function report(providers: unknown[], extra: Record<string, unknown> = {}) {
  return { asOf: NOW, targetShare: 0.8, providers, throttledHosts: [], ...extra };
}

test('a valid report parses; malformed providers are dropped, not trusted', () => {
  const parsed = parseQuotaStatus(report([
    provider(),
    provider({ id: 'bad-state', state: 'exploded' }),
    provider({ id: 'bad-window', windows: [{ windowMs: -1, used: 1 }] }),
    provider({ id: 'no-windows', windows: [] }),
    'nonsense',
    provider({ id: 'anthropic', label: 'Anthropic', state: 'ok', observeOnly: true, windows: [{ windowMs: 30 * 24 * HOUR, limit: null, backgroundCeiling: null, used: 12 }], tokens: 3400, budgetFreesAt: null }),
  ], { throttledHosts: [{ host: 'api.example.test', until: NOW + HOUR }, { host: 7, until: 'x' }] }));
  assert.ok(parsed);
  assert.deepEqual(parsed.providers.map((p) => p.id), ['abuseipdb-blacklist', 'anthropic']);
  assert.equal(parsed.providers[1]!.tokens, 3400);
  assert.deepEqual(parsed.throttledHosts, [{ host: 'api.example.test', until: NOW + HOUR }]);
  assert.equal(parseQuotaStatus({ providers: 'x' }), null);
  assert.equal(parseQuotaStatus(null), null);
});

test('window and countdown labels read plainly', () => {
  assert.equal(formatWindow(60_000), '1 min');
  assert.equal(formatWindow(HOUR), '1 h');
  assert.equal(formatWindow(24 * HOUR), '24 h');
  assert.equal(formatWindow(7 * 24 * HOUR), '7 days');
  assert.equal(formatUntil(NOW - 1, NOW), 'now');
  assert.equal(formatUntil(NOW + 12 * 60_000, NOW), 'in 12 min');
  assert.equal(formatUntil(NOW + 3 * HOUR, NOW), 'in 3 h');
  assert.equal(formatUntil(NOW + 72 * HOUR, NOW), 'in 3 days');
});

test('fetch reports HTTP and network failures instead of throwing', async () => {
  const ok = await fetchQuotaStatus((async () => new Response(JSON.stringify(report([provider()])), { status: 200 })) as typeof fetch);
  assert.equal(ok.ok, true);
  const denied = await fetchQuotaStatus((async () => new Response('{}', { status: 401 })) as typeof fetch);
  assert.deepEqual(denied, { ok: false, error: 'HTTP 401' });
  const odd = await fetchQuotaStatus((async () => new Response('{"providers":1}', { status: 200 })) as typeof fetch);
  assert.deepEqual(odd, { ok: false, error: 'unexpected response' });
  const offline = await fetchQuotaStatus((async () => { throw new Error('connection refused'); }) as typeof fetch);
  assert.deepEqual(offline, { ok: false, error: 'connection refused' });
});

test('the tab shows use against the limit, the 80% marker, and when background resumes', () => {
  const parsed = parseQuotaStatus(report([provider()]))!;
  const html = renderQuotaBudgetsHtml({ loading: false, result: { ok: true, report: parsed } }, NOW);
  assert.match(html, /data-provider="abuseipdb-blacklist"/);
  assert.match(html, /4 \/ 5 requests · 24 h window/);
  assert.match(html, /role="meter"[^>]*aria-valuemax="5" aria-valuenow="4"/);
  assert.match(html, /left:80\.0%/, 'the background ceiling marker');
  assert.match(html, /Background paused/);
  assert.match(html, /Background refreshes resume in 3 h; you can still trigger lookups\./);
  assert.match(html, /stop at 80% of each limit/);
});

test('cooldowns, estimates, tracked-only providers and throttled hosts are explained', () => {
  const parsed = parseQuotaStatus(report([
    provider({ id: 'opensky-states', label: 'OpenSky states', unit: 'credits', state: 'cooldown', cooldownUntil: NOW + 5 * 60_000, cooldownReason: 'provider_429', budgetFreesAt: null, providerRemaining: { value: 0, at: NOW }, last429At: NOW }),
    provider({ id: 'purpleair', label: 'PurpleAir', unit: 'points', state: 'ok', estimate: true, observeOnly: true, windows: [{ windowMs: 30 * 24 * HOUR, limit: null, backgroundCeiling: null, used: 1200 }], budgetFreesAt: null }),
  ], { throttledHosts: [{ host: 'api.example.test', until: NOW + HOUR }] }))!;
  const html = renderQuotaBudgetsHtml({ loading: false, result: { ok: true, report: parsed } }, NOW);
  assert.match(html, /Provider cooldown/);
  assert.match(html, /The provider asked us to wait: background calls resume in 5 min\./);
  assert.match(html, /Provider reports 0 credits left\./);
  assert.match(html, /1,200 points in the last 30 days window · no app limit/);
  assert.match(html, /tracked only/);
  assert.match(html, /Points are an estimate/);
  assert.match(html, /Also waiting on: api\.example\.test \(in 1 h\)/);
});

test('hostile text from the sidecar is escaped, and failures say where budgets come from', () => {
  const parsed = parseQuotaStatus(report([provider({ label: '<img src=x onerror=alert(1)>', unit: '"><script>', id: 'x" onmouseover="y' })], {
    throttledHosts: [{ host: '<b>evil</b>', until: NOW + HOUR }],
  }))!;
  const html = renderQuotaBudgetsHtml({ loading: false, result: { ok: true, report: parsed } }, NOW);
  assert.doesNotMatch(html, /<img|<script|<b>evil|onmouseover="y/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  const offline = renderQuotaBudgetsHtml({ loading: false, result: { ok: false, error: '<i>down</i>' } }, NOW);
  assert.match(offline, /desktop sidecar, which did not answer \(&lt;i&gt;down&lt;\/i&gt;\)/);
  assert.match(renderQuotaBudgetsHtml({ loading: true, result: null }, NOW), /Loading API budgets/);
});
