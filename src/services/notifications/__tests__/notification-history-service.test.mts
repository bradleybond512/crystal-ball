import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ACTION_BADGE,
  DOMAIN_ICON,
  HISTORY_LIMIT,
  HISTORY_SCHEMA_VERSION,
  SEVERITY_BADGE,
  __reset,
  clear,
  domainForThreatType,
  filterHistory,
  getHistory,
  loadFromSnapshot,
  record,
  snapshot,
  type NotificationHistoryEntry,
} from '../notification-history-service.ts';

const NOW = Date.parse('2026-05-11T12:00:00Z');

function partial(over: Partial<NotificationHistoryEntry> = {}) {
  return {
    domain: over.domain ?? 'seismic',
    source: over.source ?? 'push-notifier',
    action: over.action ?? 'fired',
    title: over.title ?? 'Test',
    body: over.body ?? 'Test body',
    severity: over.severity ?? 'high',
    suppressedReason: over.suppressedReason,
    ruleId: over.ruleId,
    payload: over.payload,
    recordedAt: over.recordedAt ?? NOW,
  } as const;
}

// ── domainForThreatType ───────────────────────────────────────────────────

test('domainForThreatType maps each notification threat type to its domain', () => {
  assert.equal(domainForThreatType('seismic_tier5'), 'seismic');
  assert.equal(domainForThreatType('geomagnetic_g4'), 'geomagnetic');
  assert.equal(domainForThreatType('solar_flare_x'), 'solar_flare');
  assert.equal(domainForThreatType('cap_extreme'), 'cap');
  assert.equal(domainForThreatType('hurricane_cat3'), 'hurricane');
  assert.equal(domainForThreatType('wildfire_extreme'), 'wildfire');
  assert.equal(domainForThreatType('air_quality_unhealthy'), 'air_quality');
  assert.equal(domainForThreatType('market_stress'), 'market');
});

test('domainForThreatType returns "unknown" for unrecognised / missing types', () => {
  assert.equal(domainForThreatType(undefined), 'unknown');
  assert.equal(domainForThreatType(''), 'unknown');
  assert.equal(domainForThreatType('something_new'), 'unknown');
});

// ── record + getHistory ───────────────────────────────────────────────────

test('record appends, getHistory returns reverse-chronological view', () => {
  __reset();
  record(partial({ recordedAt: NOW - 3000, title: 'oldest' }));
  record(partial({ recordedAt: NOW - 2000, title: 'middle' }));
  record(partial({ recordedAt: NOW - 1000, title: 'newest' }));
  const out = getHistory();
  assert.equal(out.length, 3);
  assert.equal(out[0]?.title, 'newest');
  assert.equal(out[2]?.title, 'oldest');
});

test('record evicts FIFO once HISTORY_LIMIT is reached', () => {
  __reset();
  for (let i = 0; i < HISTORY_LIMIT + 50; i += 1) {
    record(partial({ recordedAt: NOW + i, title: `t-${i}` }));
  }
  const all = getHistory();
  assert.equal(all.length, HISTORY_LIMIT);
  // Oldest 50 should have been evicted.
  assert.equal(all[all.length - 1]?.title, 't-50');
  assert.equal(all[0]?.title, `t-${HISTORY_LIMIT + 49}`);
});

test('record auto-generates an id when none is supplied', () => {
  __reset();
  const a = record(partial({ recordedAt: NOW }));
  const b = record(partial({ recordedAt: NOW }));
  assert.ok(a.id);
  assert.ok(b.id);
  assert.notEqual(a.id, b.id);
});

// ── filterHistory ─────────────────────────────────────────────────────────

test('filterHistory honours each predicate (domain, severity, action, since/until)', () => {
  __reset();
  record(partial({ recordedAt: NOW - 1000, domain: 'seismic',  severity: 'critical', action: 'fired' }));
  record(partial({ recordedAt: NOW - 2000, domain: 'wildfire', severity: 'medium',   action: 'suppressed' }));
  record(partial({ recordedAt: NOW - 3000, domain: 'seismic',  severity: 'low',      action: 'fired' }));
  const all = snapshot().entries;
  assert.equal(filterHistory(all, { domain: 'seismic' }).length, 2);
  assert.equal(filterHistory(all, { severity: 'critical' }).length, 1);
  assert.equal(filterHistory(all, { action: 'suppressed' }).length, 1);
  assert.equal(filterHistory(all, { sinceMs: NOW - 1500 }).length, 1);
  assert.equal(filterHistory(all, { untilMs: NOW - 1500 }).length, 2);
});

test('filterHistory treats "all" / undefined as no-op', () => {
  __reset();
  record(partial({ recordedAt: NOW, domain: 'seismic', severity: 'high', action: 'fired' }));
  record(partial({ recordedAt: NOW, domain: 'market',  severity: 'low',  action: 'suppressed' }));
  const all = snapshot().entries;
  assert.equal(filterHistory(all, { domain: 'all', severity: 'all', action: 'all' }).length, 2);
  assert.equal(filterHistory(all, {}).length, 2);
});

// ── clear ─────────────────────────────────────────────────────────────────

test('clear empties the in-memory ring', () => {
  __reset();
  record(partial({ recordedAt: NOW }));
  record(partial({ recordedAt: NOW }));
  assert.equal(getHistory().length, 2);
  clear();
  assert.equal(getHistory().length, 0);
});

// ── snapshot + loadFromSnapshot ───────────────────────────────────────────

test('snapshot / loadFromSnapshot round-trips entries with version envelope', () => {
  __reset();
  record(partial({ recordedAt: NOW, title: 'kept' }));
  record(partial({ recordedAt: NOW + 100, title: 'newer', domain: 'wildfire' }));
  const snap = snapshot();
  assert.equal(snap.version, HISTORY_SCHEMA_VERSION);
  assert.equal(snap.entries.length, 2);
  __reset();
  loadFromSnapshot(snap);
  const restored = getHistory();
  assert.equal(restored.length, 2);
  assert.equal(restored[0]?.title, 'newer');
});

test('loadFromSnapshot drops mismatched-version payloads and bad entries', () => {
  __reset();
  loadFromSnapshot({ version: 999, entries: [partial({ recordedAt: NOW })] });
  assert.equal(getHistory().length, 0);
  loadFromSnapshot({
    version: HISTORY_SCHEMA_VERSION,
    entries: [
      { id: 'ok', recordedAt: NOW, domain: 'seismic', source: 's', action: 'fired',
        title: 't', body: 'b', severity: 'high' },
      { id: 'bad', recordedAt: 'not a number', domain: 'seismic' },
      null,
      'not an entry',
    ],
  });
  assert.equal(getHistory().length, 1);
  assert.equal(getHistory()[0]?.id, 'ok');
});

test('loadFromSnapshot truncates oversize payloads to HISTORY_LIMIT', () => {
  __reset();
  const entries: NotificationHistoryEntry[] = [];
  for (let i = 0; i < HISTORY_LIMIT + 100; i += 1) {
    entries.push({
      id: `e-${i}`, recordedAt: NOW + i, domain: 'seismic', source: 's',
      action: 'fired', title: `t-${i}`, body: 'b', severity: 'high',
    });
  }
  loadFromSnapshot({ version: HISTORY_SCHEMA_VERSION, entries });
  assert.equal(getHistory().length, HISTORY_LIMIT);
});

// ── Visual constants ──────────────────────────────────────────────────────

test('DOMAIN_ICON covers every HistoryDomain value', () => {
  for (const d of ['seismic', 'geomagnetic', 'solar_flare', 'cap', 'hurricane',
    'wildfire', 'air_quality', 'market', 'cyber', 'unknown'] as const) {
    assert.ok(DOMAIN_ICON[d].length > 0);
  }
});

test('SEVERITY_BADGE + ACTION_BADGE have colour + label per value', () => {
  // Colors are CSS custom properties (var(--*)) for theming — accept both forms.
  const validColor = /^(#[0-9a-f]{6}|var\(--[a-z-]+\))$/i;
  for (const s of ['critical', 'high', 'medium', 'low'] as const) {
    assert.match(SEVERITY_BADGE[s].color, validColor);
    assert.ok(SEVERITY_BADGE[s].label);
  }
  for (const a of ['fired', 'suppressed', 'escalated'] as const) {
    assert.match(ACTION_BADGE[a].color, validColor);
    assert.ok(ACTION_BADGE[a].label);
  }
});
