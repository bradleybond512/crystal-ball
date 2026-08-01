import test from 'node:test';
import assert from 'node:assert/strict';

import { PROBES, runValidator } from '../scripts/live-contract-probes.mjs';
import { nextAction } from '../scripts/agentic-review-loop.mjs';
import { pickIssue, slugify, buildPrompt } from '../scripts/agent-dispatch.mjs';

// ── live-contract probes: validators against live-captured shapes ──
// Fixtures below are trimmed from real responses captured 2026-08-01.

const LIVE = {
  'usgs-earthquakes': '{"features":[{"properties":{"mag":1.83},"geometry":{"coordinates":[-155.24,19.31,32]}}]}',
  'emsc-earthquakes': '{"features":[{},{},{}]}',
  'coingecko-btc': '{"bitcoin":{"usd":63005}}',
  'coinbase-btc': '{"data":{"amount":"62993.975","base":"BTC","currency":"USD"}}',
  'frankfurter-usd': `{"base":"USD","rates":{${['EUR', ...Array.from({ length: 25 }, (_, i) => `C${i}`)].map((c) => `"${c}":0.87`).join(',')}}}`,
  'open-er-api-usd': `{"result":"success","rates":{${Array.from({ length: 120 }, (_, i) => `"C${i}":1`).join(',')}}}`,
  'swpc-kp': '[{"time_tag":"2026-07-25T00:00:00","Kp":1,"a_running":4,"station_count":8}]',
  'open-meteo-air-quality': '{"hourly":{"us_aqi":[43,44,45]}}',
};

test('every probe validator accepts its live-captured shape', () => {
  for (const probe of PROBES) {
    assert.ok(LIVE[probe.id], `no fixture for ${probe.id}`);
    assert.deepEqual(runValidator(probe, LIVE[probe.id]), [], probe.id);
  }
});

test('validators reject the documented drift classes', () => {
  const byId = Object.fromEntries(PROBES.map((p) => [p.id, p]));
  // Empty collection behind a 200 — the permanently-dark-feed class.
  assert.ok(runValidator(byId['usgs-earthquakes'], '{"features":[]}').length > 0);
  // Renamed/missing field.
  assert.ok(runValidator(byId['coingecko-btc'], '{"bitcoin":{}}').length > 0);
  // Error carried inside a 200 body.
  assert.ok(runValidator(byId['open-er-api-usd'], '{"result":"error","rates":{}}').length > 0);
  // Format regression: SWPC's OTHER documented format (array-of-arrays).
  assert.ok(runValidator(byId['swpc-kp'], '[["time_tag","Kp"],["2026-08-01","3"]]').length > 0);
  // Bot-challenge page: HTTP 200 serving HTML.
  assert.ok(runValidator(byId['coinbase-btc'], '<html><body>Just a moment...</body></html>')[0].includes('not JSON'));
});

// ── review loop: cycle bookkeeping ──

test('the loop records at zero blocking, repairs through cycle 2, escalates at 3', () => {
  assert.equal(nextAction({}, 'claude/x', 'a'.repeat(40), 0).action, 'record');
  assert.equal(nextAction({}, 'claude/x', 'a'.repeat(40), 3).action, 'repair');
  const after1 = { 'claude/x': { cycles: 1 } };
  assert.equal(nextAction(after1, 'claude/x', 'a'.repeat(40), 2).action, 'repair');
  const after2 = { 'claude/x': { cycles: 2 } };
  const esc = nextAction(after2, 'claude/x', 'a'.repeat(40), 1);
  assert.equal(esc.action, 'escalate');
  // A clean review records regardless of past cycles AND resets the counter,
  // so a later unrelated change on the same branch starts fresh.
  const rec = nextAction(after2, 'claude/x', 'a'.repeat(40), 0);
  assert.equal(rec.action, 'record');
  assert.equal(rec.cycles, 0);
});

// ── dispatcher: claim discipline ──

test('the dispatcher picks the oldest unclaimed agent-ok issue', () => {
  const issues = [
    { number: 3, title: 'newer', createdAt: '2026-08-01T10:00:00Z', labels: [] },
    { number: 1, title: 'claimed already', createdAt: '2026-07-01T10:00:00Z', labels: [{ name: 'agent-claimed' }] },
    { number: 2, title: 'oldest unclaimed', createdAt: '2026-07-15T10:00:00Z', labels: [] },
  ];
  assert.equal(pickIssue(issues).number, 2);
  assert.equal(pickIssue([]), null);
});

test('slug and prompt are self-contained', () => {
  assert.equal(slugify('Fix: NWS polygon match!!', 42), 'issue-42-fix-nws-polygon-match');
  const p = buildPrompt({ number: 7, title: 'T', body: 'B' });
  assert.match(p, /issue #7/);
  assert.match(p, /agentic-review-loop/);
  assert.match(p, /Closes #7/);
});
