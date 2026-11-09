import assert from 'node:assert/strict';
import test from 'node:test';
import { createQuotaGovernor } from '../../../../src-tauri/sidecar/quota-governor.mjs';
import { parseQuotaStatus, fetchQuotaStatus } from '../quota-budgets.ts';
import { renderQuotaBudgetsHtml, createQuotaBudgetsController } from '../../../components/system-diagnostic-budgets.ts';
const NOW = 1_800_000_000_000;
function provider(extra = {}) { return { id: 'newsapi', label: 'NewsAPI', unit: 'requests', estimate: false, unverified: false, observeOnly: false, state: 'background_paused', windows: [{ windowMs: 86400000, limit: 100, backgroundCeiling: 80, used: 80 }], cooldownUntil: null, cooldownReason: null, budgetFreesAt: NOW + 60000, providerRemaining: null, last429At: null, ...extra }; }
function report(extra = {}) { return { asOf: NOW, targetShare: 0.8, providers: [provider()], throttledHosts: [], ...extra }; }
test('quota schema fails closed instead of displaying malformed or empty healthy usage', () => {
  assert.ok(parseQuotaStatus(report()));
  for (const raw of [null, report({ providers: [] }), report({ providers: Array.from({ length: 65 }, (_, i) => provider({ id: `provider-${i}` })) }), report({ targetShare: -1 }), report({ asOf: NaN }), report({ asOf: 9e15 }), report({ targetShare: 0 }), report({ providers: [provider(), provider()] }), report({ throttledHosts: Array(65).fill({ host: 'example.test', until: NOW }) })]) assert.equal(parseQuotaStatus(raw), null);
  for (const extra of [{ state: 'healthy' }, { label: 'x'.repeat(81) }, { tokens: -1 }, { tokens: 1e100 }, { cooldownUntil: 9e15 }, { providerRemaining: { value: 1, at: 9e15 } }, { estimate: 'yes' }, { cooldownUntil: -1 }, { providerRemaining: { value: -1, at: NOW } }, { windows: [] }, { windows: [{ windowMs: 1, used: -1, limit: 5, backgroundCeiling: 4 }] }, { windows: [{ windowMs: 1, used: 1, limit: 5, backgroundCeiling: 6 }] }, { windows: [{ windowMs: 1, used: 1, limit: null, backgroundCeiling: 1 }] }]) assert.equal(parseQuotaStatus(report({ providers: [provider(),provider({ id: 'abuse', ...extra })] })), null, JSON.stringify(extra));
  const parsed = parseQuotaStatus(report({ secret: 'excluded', providers: [provider({ unknown: 'excluded' })] }))!;
  assert.equal(JSON.stringify(parsed).includes('excluded'), false);
});
test('quota rendering escapes every string and preserves truthful advisory limits', () => {
  const parsed = parseQuotaStatus(report({ providers: [provider({ label: '<img src=x>', unit: '<u>', state: 'cooldown', cooldownUntil: NOW + 60000, estimate: true, unverified: true })], throttledHosts: [{ host: '<b>host</b>', until: NOW + 60000 }] }))!;
  const html = renderQuotaBudgetsHtml({ loading: false, result: { ok: true, report: parsed } }, NOW);
  assert.ok(html.includes('&lt;img src=x&gt;')); assert.ok(html.includes('&lt;u&gt;')); assert.ok(html.includes('&lt;b&gt;host&lt;/b&gt;'));
  assert.match(html, /not blocked by the app/); assert.match(html, /best-effort/i); assert.match(html, /unsupported/i); assert.match(html, /another limit may still apply/i); assert.match(html, /estimate/i); assert.match(html, /Last updated/); assert.match(html, /usage counts, not provider responses/); assert.match(html, /PurpleAir responses remain memory-only/);
  assert.doesNotMatch(html, /Counts survive restarts|rest is kept|NaN|undefined/);
  assert.match(renderQuotaBudgetsHtml({ loading: false, result: { ok: false, error: '<script>' } }), /&lt;script&gt;/);
  const uncapped = parseQuotaStatus(report({ providers: [provider({ observeOnly: true, windows: [{ windowMs: 1000, limit: null, backgroundCeiling: null, used: 2 }], tokens: 100 })] }))!;
  assert.match(renderQuotaBudgetsHtml({ loading: false, result: { ok: true, report: uncapped } }), /No app numeric cap/);
});
test('quota client rejects HTTP/schema errors and aborts bounded requests without reporting zero usage', async () => {
  const ok = await fetchQuotaStatus(async () => new Response(JSON.stringify(report())), undefined, true); assert.equal(ok.ok, true);
  assert.equal((await fetchQuotaStatus(async () => new Response('{}'), undefined, true)).ok, false);
  assert.equal((await fetchQuotaStatus(async () => new Response(JSON.stringify(report()), { status: 503 }), undefined, true)).ok, false);
  const abort = new AbortController(); let observed;
  const pending = fetchQuotaStatus(async (_url, init) => { observed = init; return new Promise(() => {}); }, abort.signal, true);
  abort.abort();
  const result = await Promise.race([pending, new Promise(resolve => setTimeout(() => resolve({ ok: true }), 50))]);
  assert.equal(result.ok, false); assert.equal(observed.signal, abort.signal); assert.equal(observed.cache, 'no-store');
});
test('quota controller throttles one flight and ignores late completion after leave or destroy', async () => {
  let now = NOW; const calls = []; let changes = 0;
  const c = createQuotaBudgetsController(() => changes++, { now: () => now, fetchStatus: signal => new Promise(resolve => calls.push({ signal, resolve })) });
  c.setActive(false); assert.equal(calls.length, 0);
  c.setActive(true); c.setActive(true); assert.equal(calls.length, 1);
  c.setActive(false); assert.equal(calls[0].signal.aborted, true);
  calls[0].resolve({ ok: true, report: parseQuotaStatus(report()) }); await new Promise(resolve => setImmediate(resolve)); assert.equal(changes, 0);
  c.setActive(true); assert.equal(calls.length, 2);
  calls[1].resolve({ ok: false, error: 'offline' }); await new Promise(resolve => setImmediate(resolve)); assert.equal(changes, 1);
  c.setActive(true); assert.equal(calls.length, 2);
  now += 30000; c.setActive(true); assert.equal(calls.length, 3);
  c.destroy(); assert.equal(calls[2].signal.aborted, true);
  calls[2].resolve({ ok: true, report: parseQuotaStatus(report()) }); await new Promise(resolve => setImmediate(resolve)); assert.equal(changes, 1);
  c.setActive(true); assert.equal(calls.length, 3);
});


test('all thirteen actual governor records parse without dropping multi-window or uncapped providers', () => {
  const raw = createQuotaGovernor({ now: () => NOW }).status();
  const parsed = parseQuotaStatus(raw);
  assert.ok(parsed);
  assert.equal(parsed.providers.length, 13);
  assert.deepEqual(parsed, raw);
});

test('quota request timeout aborts transport and leaves a throttled unavailable view', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let signal; let count = 0; let changes = 0;
  const c = createQuotaBudgetsController(() => changes++, { now: () => NOW, fetchStatus: requestSignal => { count++; signal = requestSignal; return fetchQuotaStatus(async () => new Promise(() => {}), requestSignal, true); } });
  c.setActive(true); t.mock.timers.tick(5000);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(signal.aborted, true); assert.equal(changes, 1); assert.match(c.html(), /timed out/);
  c.setActive(true); assert.equal(count, 1); c.destroy();
});


test('web quota view stays unavailable without contacting any remote endpoint', async () => {
  let calls = 0;
  const result = await fetchQuotaStatus(async () => { calls++; return new Response(JSON.stringify(report())); }, undefined, false);
  assert.equal(result.ok, false); assert.equal(calls, 0);
});

test('old quota completion cannot overwrite a newer active request after rapid return', async () => {
  const calls = []; let changes = 0;
  const c = createQuotaBudgetsController(() => changes++, { fetchStatus: signal => new Promise(resolve => calls.push({ signal, resolve })) });
  c.setActive(true); c.setActive(false); c.setActive(true);
  calls[0].resolve({ ok: false, error: 'obsolete failure' }); await new Promise(resolve => setImmediate(resolve));
  assert.equal(changes, 0); assert.doesNotMatch(c.html(), /obsolete failure/);
  calls[1].resolve({ ok: false, error: 'current failure' }); await new Promise(resolve => setImmediate(resolve));
  assert.equal(changes, 1); assert.match(c.html(), /current failure/); c.destroy();
});
