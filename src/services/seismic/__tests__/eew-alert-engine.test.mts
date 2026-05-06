import assert from 'node:assert/strict';
import test from 'node:test';

import {
  evaluateEewAlerts,
  emptyLedger,
  type EewAlertLedger,
  type EewTier,
} from '../eew-alert-engine.ts';
import { fuseCanonicalEvents } from '../seismic-fusion.ts';
import type { CanonicalSeismicEvent } from '../seismic-types.ts';
import type { SavedPlaceLite } from '../shaking-estimator.ts';

const NOW = 1_745_000_000_000;
const HOME: SavedPlaceLite = { id: 'home', name: 'Home', lat: 41.61, lon: -86.72 };

function quake(overrides: Partial<CanonicalSeismicEvent> & { id: string }): CanonicalSeismicEvent {
  return {
    id: overrides.id,
    source: overrides.source ?? 'usgs',
    sourceEventId: overrides.sourceEventId ?? overrides.id,
    magnitude: 'magnitude' in overrides ? overrides.magnitude! : 6.0,
    depthKm: 'depthKm' in overrides ? overrides.depthKm! : 10,
    lat: overrides.lat ?? 0,
    lon: overrides.lon ?? 0,
    place: overrides.place ?? '',
    occurredAt: overrides.occurredAt ?? NOW,
    status: overrides.status ?? 'reviewed',
    confidence: overrides.confidence ?? 0.85,
    pagerAlert: overrides.pagerAlert,
    tsunamiFlag: overrides.tsunamiFlag,
    updatedAt: overrides.updatedAt,
  };
}

function fuse(canonical: CanonicalSeismicEvent) {
  return fuseCanonicalEvents([canonical])[0]!;
}

// ── Tier thresholds: anywhere clauses ──────────────────────────────────

test('M3.9 anywhere → no alert', () => {
  const out = evaluateEewAlerts({
    events: [fuse(quake({ id: 'a', magnitude: 3.9 }))],
    savedPlaces: [],
    ledger: emptyLedger(),
    nowMs: NOW + 1000,
  });
  assert.equal(out.alerts.length, 0);
});

test('M4.0 anywhere → TIER_1_INFO', () => {
  const out = evaluateEewAlerts({
    events: [fuse(quake({ id: 'a', magnitude: 4.0 }))],
    savedPlaces: [],
    ledger: emptyLedger(),
    nowMs: NOW + 1000,
  });
  assert.equal(out.alerts.length, 1);
  assert.equal(out.alerts[0]!.tier, 'TIER_1_INFO');
});

test('M5.5 anywhere → TIER_2_WATCH', () => {
  const out = evaluateEewAlerts({
    events: [fuse(quake({ id: 'a', magnitude: 5.5 }))],
    savedPlaces: [],
    ledger: emptyLedger(),
    nowMs: NOW + 1000,
  });
  assert.equal(out.alerts[0]!.tier, 'TIER_2_WATCH');
});

test('M6.5 anywhere → TIER_3_WARNING', () => {
  const out = evaluateEewAlerts({
    events: [fuse(quake({ id: 'a', magnitude: 6.5 }))],
    savedPlaces: [],
    ledger: emptyLedger(),
    nowMs: NOW + 1000,
  });
  assert.equal(out.alerts[0]!.tier, 'TIER_3_WARNING');
});

test('M7.0 anywhere → TIER_4_SEVERE', () => {
  const out = evaluateEewAlerts({
    events: [fuse(quake({ id: 'a', magnitude: 7.0 }))],
    savedPlaces: [],
    ledger: emptyLedger(),
    nowMs: NOW + 1000,
  });
  assert.equal(out.alerts[0]!.tier, 'TIER_4_SEVERE');
});

test('M8.0 anywhere → TIER_5_EXTREME', () => {
  const out = evaluateEewAlerts({
    events: [fuse(quake({ id: 'a', magnitude: 8.0 }))],
    savedPlaces: [],
    ledger: emptyLedger(),
    nowMs: NOW + 1000,
  });
  assert.equal(out.alerts[0]!.tier, 'TIER_5_EXTREME');
});

// ── Saved-place proximity clauses ──────────────────────────────────────

test('M2.5 within 200km of saved place → TIER_1_INFO', () => {
  // Lat 41.61 + ~1° lat ≈ 111km north; well within 200km.
  const out = evaluateEewAlerts({
    events: [fuse(quake({ id: 'a', magnitude: 2.5, lat: 42.5, lon: -86.72 }))],
    savedPlaces: [HOME],
    ledger: emptyLedger(),
    nowMs: NOW + 1000,
  });
  assert.equal(out.alerts.length, 1);
  assert.equal(out.alerts[0]!.tier, 'TIER_1_INFO');
});

test('M2.5 distant (>200km) from saved place → no alert', () => {
  const out = evaluateEewAlerts({
    events: [fuse(quake({ id: 'a', magnitude: 2.5, lat: 0, lon: 0 }))],
    savedPlaces: [HOME],
    ledger: emptyLedger(),
    nowMs: NOW + 1000,
  });
  assert.equal(out.alerts.length, 0);
});

test('M4.0 within 300km of saved place → TIER_2_WATCH', () => {
  const out = evaluateEewAlerts({
    events: [fuse(quake({ id: 'a', magnitude: 4.0, lat: 43.6, lon: -86.72 }))],
    savedPlaces: [HOME],
    ledger: emptyLedger(),
    nowMs: NOW + 1000,
  });
  assert.equal(out.alerts[0]!.tier, 'TIER_2_WATCH');
});

test('M5.0 within 200km of saved place → TIER_3_WARNING (saved-place clause beats anywhere)', () => {
  const out = evaluateEewAlerts({
    events: [fuse(quake({ id: 'a', magnitude: 5.0, lat: 42.5, lon: -86.72 }))],
    savedPlaces: [HOME],
    ledger: emptyLedger(),
    nowMs: NOW + 1000,
  });
  // M5.0 anywhere is below TIER_2_WATCH (M5.5). Saved-place clause
  // upgrades it to TIER_3_WARNING.
  assert.equal(out.alerts[0]!.tier, 'TIER_3_WARNING');
});

test('M7.0 within 500km of saved place → TIER_5_EXTREME', () => {
  const out = evaluateEewAlerts({
    events: [fuse(quake({ id: 'a', magnitude: 7.0, lat: 45.0, lon: -86.72 }))],
    savedPlaces: [HOME],
    ledger: emptyLedger(),
    nowMs: NOW + 1000,
  });
  // M7.0 anywhere is TIER_4_SEVERE. Within 500km of saved place
  // upgrades to TIER_5_EXTREME.
  assert.equal(out.alerts[0]!.tier, 'TIER_5_EXTREME');
});

// ── Tsunami clause (degraded — only watch fires today) ─────────────────

test('tsunamiFlag true at any magnitude → at least TIER_2_WATCH', () => {
  const out = evaluateEewAlerts({
    events: [fuse(quake({ id: 'a', magnitude: 4.5, tsunamiFlag: true }))],
    savedPlaces: [],
    ledger: emptyLedger(),
    nowMs: NOW + 1000,
  });
  assert.equal(out.alerts[0]!.tier, 'TIER_2_WATCH');
  assert.match(out.alerts[0]!.reason, /tsunami/i);
});

test('tsunamiFlag does not lower a higher magnitude tier', () => {
  // M7.0 anywhere is TIER_4_SEVERE; tsunami shouldn't downgrade it.
  const out = evaluateEewAlerts({
    events: [fuse(quake({ id: 'a', magnitude: 7.0, tsunamiFlag: true }))],
    savedPlaces: [],
    ledger: emptyLedger(),
    nowMs: NOW + 1000,
  });
  assert.equal(out.alerts[0]!.tier, 'TIER_4_SEVERE');
});

// ── Dedup ──────────────────────────────────────────────────────────────

test('same eventId + same tier within 1h → suppressed', () => {
  const event = fuse(quake({ id: 'a', magnitude: 5.5 }));
  const first = evaluateEewAlerts({
    events: [event],
    savedPlaces: [],
    ledger: emptyLedger(),
    nowMs: NOW + 1000,
  });
  assert.equal(first.alerts.length, 1);
  const second = evaluateEewAlerts({
    events: [event],
    savedPlaces: [],
    ledger: first.updatedLedger,
    nowMs: NOW + 1000 + 30 * 60 * 1000,
  });
  assert.equal(second.alerts.length, 0);
});

test('same eventId + same tier just past 1h → fires again', () => {
  const event = fuse(quake({ id: 'a', magnitude: 5.5 }));
  const first = evaluateEewAlerts({
    events: [event],
    savedPlaces: [],
    ledger: emptyLedger(),
    nowMs: NOW + 1000,
  });
  const second = evaluateEewAlerts({
    events: [event],
    savedPlaces: [],
    ledger: first.updatedLedger,
    nowMs: NOW + 1000 + 60 * 60 * 1000 + 1,
  });
  assert.equal(second.alerts.length, 1);
  assert.equal(second.alerts[0]!.tier, 'TIER_2_WATCH');
});

// ── Upgrade detection ──────────────────────────────────────────────────

test('upgrade: M5.5 → M7.5 produces TIER_4 alert with upgradedFrom=TIER_2', () => {
  const original = fuse(quake({ id: 'a', sourceEventId: 'a', magnitude: 5.5 }));
  const first = evaluateEewAlerts({
    events: [original],
    savedPlaces: [],
    ledger: emptyLedger(),
    nowMs: NOW + 1000,
  });
  assert.equal(first.alerts[0]!.tier, 'TIER_2_WATCH');

  const upgraded = fuse(quake({ id: 'a', sourceEventId: 'a', magnitude: 7.5 }));
  const second = evaluateEewAlerts({
    events: [upgraded],
    savedPlaces: [],
    ledger: first.updatedLedger,
    nowMs: NOW + 1000 + 60_000,
  });
  assert.equal(second.alerts.length, 1);
  assert.equal(second.alerts[0]!.tier, 'TIER_4_SEVERE');
  assert.equal(second.alerts[0]!.upgradedFrom, 'TIER_2_WATCH');
});

test('downgrade is suppressed (never go from TIER_4 back to TIER_2)', () => {
  const big = fuse(quake({ id: 'a', sourceEventId: 'a', magnitude: 7.0 }));
  const first = evaluateEewAlerts({
    events: [big],
    savedPlaces: [],
    ledger: emptyLedger(),
    nowMs: NOW + 1000,
  });
  assert.equal(first.alerts[0]!.tier, 'TIER_4_SEVERE');

  const downgraded = fuse(quake({ id: 'a', sourceEventId: 'a', magnitude: 5.5 }));
  const second = evaluateEewAlerts({
    events: [downgraded],
    savedPlaces: [],
    ledger: first.updatedLedger,
    nowMs: NOW + 1000 + 30 * 60 * 1000,
  });
  assert.equal(second.alerts.length, 0);
});

// ── Ledger expiry ──────────────────────────────────────────────────────

test('ledger entries older than 24h are evicted', () => {
  const event = fuse(quake({ id: 'a', magnitude: 5.5 }));
  const first = evaluateEewAlerts({
    events: [event],
    savedPlaces: [],
    ledger: emptyLedger(),
    nowMs: NOW + 1000,
  });
  // Sanity: entry exists.
  assert.ok(first.updatedLedger.events['a'] !== undefined);

  // 24h+1s later, with no event seen, entry should be evicted on next eval.
  const later = evaluateEewAlerts({
    events: [],
    savedPlaces: [],
    ledger: first.updatedLedger,
    nowMs: NOW + 1000 + 24 * 3600 * 1000 + 1,
  });
  assert.equal(later.updatedLedger.events['a'], undefined);
});

// ── Empty input ────────────────────────────────────────────────────────

test('no events → no alerts and ledger preserved', () => {
  const ledger: EewAlertLedger = {
    events: { keep: { highestTier: 'TIER_1_INFO' as EewTier, tierFiredAt: { TIER_1_INFO: NOW } } },
  };
  const out = evaluateEewAlerts({
    events: [],
    savedPlaces: [],
    ledger,
    nowMs: NOW + 1000,
  });
  assert.equal(out.alerts.length, 0);
  // Within 24h ledger entry should still be present.
  assert.ok(out.updatedLedger.events['keep'] !== undefined);
});

// ── Reason string includes useful context ──────────────────────────────

test('reason string mentions magnitude', () => {
  const out = evaluateEewAlerts({
    events: [fuse(quake({ id: 'a', magnitude: 6.7 }))],
    savedPlaces: [],
    ledger: emptyLedger(),
    nowMs: NOW + 1000,
  });
  assert.match(out.alerts[0]!.reason, /M\s*6\.7/);
});

test('saved-place upgrade reason mentions place name', () => {
  const out = evaluateEewAlerts({
    events: [fuse(quake({ id: 'a', magnitude: 5.0, lat: 42.5, lon: -86.72 }))],
    savedPlaces: [HOME],
    ledger: emptyLedger(),
    nowMs: NOW + 1000,
  });
  assert.match(out.alerts[0]!.reason, /Home/);
});
