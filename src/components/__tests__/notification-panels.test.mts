/**
 * Integration tests for the Notification Settings + History panels.
 *
 * Covers:
 *   - Settings service round-trip (per-domain + global mutations + reset)
 *   - History service ring + filter behavior the history panel relies on
 *   - Pure helpers shared with the history panel (timestamp, range, payload)
 *   - The synthetic Test-notification payload the settings panel records
 *
 * Stays out of the DOM — both panels' render methods are HTML-template
 * strings, not state machines, so we test the deterministic boundary
 * between the panel and its services rather than mounting JSDOM.
 */
/* eslint-disable @typescript-eslint/no-unused-vars -- tests intentionally introspect via aliased imports */

import assert from 'node:assert/strict';
import test from 'node:test';

// Polyfill localStorage for the settings service (tsx → node runtime).
declare global { var localStorage: Storage | undefined; }
function installLocalStorage(): void {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: Storage }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => { store.clear(); },
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() { return store.size; },
  } as Storage;
}
installLocalStorage();

import {
  getSettings,
  resetSettings,
  shouldNotify,
  updateDomainSettings,
  updateGlobalSettings,
} from '../../services/notifications/notification-settings-service.ts';

import {
  HISTORY_LIMIT,
  __reset as resetHistory,
  clear as clearHistory,
  domainForThreatType,
  filterHistory,
  getHistory,
  loadFromSnapshot,
  nextHistoryId,
  record as recordHistory,
  snapshot,
} from '../../services/notifications/notification-history-service.ts';

import {
  formatPayload,
  formatTimestamp,
  sinceMsForRange,
  TIME_RANGES,
} from '../notification-history-helpers.ts';

import {
  buildTestHistoryEntry,
  HISTORY_DOMAIN_FOR_SETTINGS,
  SETTINGS_DOMAIN_LABELS,
  SETTINGS_DOMAINS,
  settingsToHistorySeverity,
} from '../notification-settings-helpers.ts';

// ── Settings service round-trip ────────────────────────────────────────

test('settings: defaults expose all 11 domains and master-mute off', () => {
  resetSettings();
  const s = getSettings();
  assert.equal(s.global.masterMute, false);
  assert.equal(Object.keys(s.domains).length, 11);
  for (const d of ['earthquakes', 'wildfire', 'aviation', 'maritime',
    'biosurveillance', 'space_weather', 'infrastructure', 'geopolitical',
    'weather', 'cyber', 'supply'] as const) {
    assert.equal(s.domains[d].enabled, true);
    assert.equal(s.domains[d].threshold, 'medium');
    assert.equal(s.domains[d].channel, 'both');
  }
});

test('settings: updateDomainSettings persists a single field patch', () => {
  resetSettings();
  updateDomainSettings('wildfire', { threshold: 'high' });
  assert.equal(getSettings().domains.wildfire.threshold, 'high');
  // Untouched fields stay at defaults.
  assert.equal(getSettings().domains.wildfire.channel, 'both');
});

test('settings: updateGlobalSettings flips master mute', () => {
  resetSettings();
  updateGlobalSettings({ masterMute: true });
  assert.equal(getSettings().global.masterMute, true);
});

test('settings: resetSettings restores defaults after mutations', () => {
  updateDomainSettings('cyber', { enabled: false, threshold: 'critical' });
  updateGlobalSettings({ masterMute: true, quietHoursStart: '01:00' });
  resetSettings();
  const s = getSettings();
  assert.equal(s.global.masterMute, false);
  assert.equal(s.global.quietHoursStart, '22:00');
  assert.equal(s.domains.cyber.enabled, true);
  assert.equal(s.domains.cyber.threshold, 'medium');
});

test('settings: shouldNotify respects masterMute', () => {
  resetSettings();
  updateGlobalSettings({ masterMute: true });
  assert.equal(shouldNotify('weather', 'critical'), false);
});

test('settings: shouldNotify respects threshold ladder', () => {
  resetSettings();
  updateDomainSettings('weather', { threshold: 'high' });
  assert.equal(shouldNotify('weather', 'medium'), false);
  assert.equal(shouldNotify('weather', 'high'), true);
  assert.equal(shouldNotify('weather', 'critical'), true);
});

test('settings: shouldNotify drops disabled domains', () => {
  resetSettings();
  updateDomainSettings('cyber', { enabled: false });
  assert.equal(shouldNotify('cyber', 'critical'), false);
});

// ── History service ring + filter ──────────────────────────────────────

test('history: record + getHistory returns newest-first', () => {
  resetHistory();
  const t0 = 1_000_000_000_000;
  recordHistory({ domain: 'seismic', source: 'test', action: 'fired', title: 'a', body: 'a', severity: 'medium', recordedAt: t0 });
  recordHistory({ domain: 'wildfire', source: 'test', action: 'fired', title: 'b', body: 'b', severity: 'high', recordedAt: t0 + 1000 });
  const out = getHistory();
  assert.equal(out.length, 2);
  assert.equal(out[0]!.title, 'b');
  assert.equal(out[1]!.title, 'a');
});

test('history: ring evicts oldest at HISTORY_LIMIT (FIFO)', () => {
  resetHistory();
  for (let i = 0; i < HISTORY_LIMIT + 5; i += 1) {
    recordHistory({
      domain: 'seismic', source: 'test', action: 'fired',
      title: `t-${i}`, body: '', severity: 'low',
      recordedAt: 1_000_000_000_000 + i,
    });
  }
  const out = getHistory();
  assert.equal(out.length, HISTORY_LIMIT);
  // Newest first → first item is the most recent (i = LIMIT+4).
  assert.equal(out[0]!.title, `t-${HISTORY_LIMIT + 4}`);
  // Oldest survivor is i = 5 (first 5 evicted).
  assert.equal(out.at(-1)!.title, 't-5');
});

test('history: clear empties the ring', () => {
  resetHistory();
  recordHistory({ domain: 'cap', source: 't', action: 'fired', title: 'x', body: '', severity: 'high' });
  clearHistory();
  assert.equal(getHistory().length, 0);
});

test('history: filterHistory by domain', () => {
  resetHistory();
  recordHistory({ domain: 'seismic', source: 't', action: 'fired', title: 'a', body: '', severity: 'medium' });
  recordHistory({ domain: 'wildfire', source: 't', action: 'fired', title: 'b', body: '', severity: 'medium' });
  const out = filterHistory(getHistory(), { domain: 'wildfire' });
  assert.equal(out.length, 1);
  assert.equal(out[0]!.title, 'b');
});

test('history: filterHistory by severity', () => {
  resetHistory();
  recordHistory({ domain: 'cyber', source: 't', action: 'fired', title: 'a', body: '', severity: 'low' });
  recordHistory({ domain: 'cyber', source: 't', action: 'fired', title: 'b', body: '', severity: 'critical' });
  const out = filterHistory(getHistory(), { severity: 'critical' });
  assert.equal(out.length, 1);
  assert.equal(out[0]!.title, 'b');
});

test('history: filterHistory by action', () => {
  resetHistory();
  recordHistory({ domain: 'cap', source: 't', action: 'fired', title: 'fire', body: '', severity: 'medium' });
  recordHistory({ domain: 'cap', source: 't', action: 'suppressed', title: 'sup', body: '', severity: 'medium', suppressedReason: 'quiet-hours' });
  const out = filterHistory(getHistory(), { action: 'suppressed' });
  assert.equal(out.length, 1);
  assert.equal(out[0]!.suppressedReason, 'quiet-hours');
});

test('history: filterHistory by sinceMs window', () => {
  resetHistory();
  const t = 1_000_000_000_000;
  recordHistory({ domain: 'seismic', source: 't', action: 'fired', title: 'old', body: '', severity: 'low', recordedAt: t });
  recordHistory({ domain: 'seismic', source: 't', action: 'fired', title: 'new', body: '', severity: 'low', recordedAt: t + 5000 });
  const out = filterHistory(getHistory(), { sinceMs: t + 1000 });
  assert.equal(out.length, 1);
  assert.equal(out[0]!.title, 'new');
});

test('history: domainForThreatType maps producer prefixes', () => {
  assert.equal(domainForThreatType('seismic_tier3'), 'seismic');
  assert.equal(domainForThreatType('wildfire_extreme'), 'wildfire');
  assert.equal(domainForThreatType('cap_severe'), 'cap');
  assert.equal(domainForThreatType('geomagnetic_g4'), 'geomagnetic');
  assert.equal(domainForThreatType('solar_flare_x'), 'solar_flare');
  assert.equal(domainForThreatType('hurricane_cat3'), 'hurricane');
  assert.equal(domainForThreatType('air_quality_unhealthy'), 'air_quality');
  assert.equal(domainForThreatType('market_stress'), 'market');
  assert.equal(domainForThreatType('cyber_breach'), 'cyber');
  assert.equal(domainForThreatType(undefined), 'unknown');
  assert.equal(domainForThreatType('totally-unmapped'), 'unknown');
});

test('history: snapshot + loadFromSnapshot round-trip', () => {
  resetHistory();
  recordHistory({ domain: 'cap', source: 't', action: 'fired', title: 'rt', body: 'b', severity: 'high' });
  const snap = snapshot();
  resetHistory();
  loadFromSnapshot(snap);
  assert.equal(getHistory().length, 1);
  assert.equal(getHistory()[0]!.title, 'rt');
});

test('history: loadFromSnapshot rejects unknown schema version', () => {
  resetHistory();
  loadFromSnapshot({ version: 999, entries: [{ id: 'x', recordedAt: 0, domain: 'cyber', source: 't', action: 'fired', title: 'x', body: '', severity: 'low' }] });
  assert.equal(getHistory().length, 0);
});

test('history: nextHistoryId is monotonically distinct', () => {
  const a = nextHistoryId(100);
  const b = nextHistoryId(100);
  assert.notEqual(a, b);
  assert.match(a, /^nh-/);
});

// ── History panel helpers ──────────────────────────────────────────────

test('helpers: sinceMsForRange("all") is undefined (no lower bound)', () => {
  assert.equal(sinceMsForRange('all', 0), undefined);
});

test('helpers: sinceMsForRange("h1") is now - 1h', () => {
  const now = 5_000_000;
  assert.equal(sinceMsForRange('h1', now), now - 60 * 60 * 1000);
});

test('helpers: sinceMsForRange("h24") is now - 24h', () => {
  const now = 5_000_000;
  assert.equal(sinceMsForRange('h24', now), now - 24 * 60 * 60 * 1000);
});

test('helpers: sinceMsForRange("d7") is now - 7d', () => {
  const now = 5_000_000;
  assert.equal(sinceMsForRange('d7', now), now - 7 * 24 * 60 * 60 * 1000);
});

test('helpers: TIME_RANGES exposes the four presets', () => {
  const ids = TIME_RANGES.map((r) => r.id).sort();
  assert.deepEqual(ids, ['all', 'd7', 'h1', 'h24']);
});

test('helpers: formatTimestamp seconds/minutes/hours/days', () => {
  const now = 10_000_000;
  assert.equal(formatTimestamp(now - 30_000, now), '30s ago');
  assert.equal(formatTimestamp(now - 5 * 60_000, now), '5m ago');
  assert.equal(formatTimestamp(now - 3 * 60 * 60_000, now), '3h ago');
  assert.equal(formatTimestamp(now - 4 * 24 * 60 * 60_000, now), '4d ago');
});

test('helpers: formatTimestamp future → "just now"', () => {
  assert.equal(formatTimestamp(2000, 1000), 'just now');
});

test('helpers: formatPayload empty / undefined', () => {
  assert.equal(formatPayload(undefined), '(no payload)');
  assert.equal(formatPayload({}), '(empty)');
});

test('helpers: formatPayload shows key: value lines and skips undefined', () => {
  const out = formatPayload({ a: 1, b: 'x', c: undefined, d: null });
  assert.match(out, /^a: 1$/m);
  assert.match(out, /^b: x$/m);
  assert.match(out, /^d: null$/m);
  assert.doesNotMatch(out, /^c:/m);
});

// ── Settings panel synthetic-test payload ─────────────────────────────

test('panel: buildTestHistoryEntry maps settings domain → history domain', () => {
  const entry = buildTestHistoryEntry('earthquakes', 'medium');
  assert.equal(entry.domain, 'seismic');
  assert.equal(entry.action, 'fired');
  assert.equal(entry.ruleId, 'test-earthquakes');
  assert.match(entry.title, /Earthquakes/);
});

test('panel: buildTestHistoryEntry severity mirrors the domain threshold', () => {
  const entry = buildTestHistoryEntry('wildfire', 'critical');
  assert.equal(entry.severity, 'critical');
});

test('panel: buildTestHistoryEntry collapses settings "info" → history "low"', () => {
  const entry = buildTestHistoryEntry('cyber', 'info');
  assert.equal(entry.severity, 'low');
});

test('panel: buildTestHistoryEntry payload is synthetic + carries domain', () => {
  const entry = buildTestHistoryEntry('geopolitical', 'high', 12_345);
  assert.equal(entry.payload.synthetic, true);
  assert.equal(entry.payload.settingsDomain, 'geopolitical');
  assert.equal(entry.payload.firedAt, 12_345);
});

test('panel: settingsToHistorySeverity collapses info → low', () => {
  assert.equal(settingsToHistorySeverity('info'), 'low');
  assert.equal(settingsToHistorySeverity('low'), 'low');
  assert.equal(settingsToHistorySeverity('critical'), 'critical');
});

test('panel: HISTORY_DOMAIN_FOR_SETTINGS covers every settings domain', () => {
  for (const d of SETTINGS_DOMAINS) {
    assert.ok(HISTORY_DOMAIN_FOR_SETTINGS[d], `missing mapping for ${d}`);
  }
});

test('panel: SETTINGS_DOMAIN_LABELS labels all 11 domains', () => {
  for (const d of SETTINGS_DOMAINS) {
    assert.equal(typeof SETTINGS_DOMAIN_LABELS[d], 'string');
    assert.ok((SETTINGS_DOMAIN_LABELS[d] ?? '').length > 0);
  }
});
