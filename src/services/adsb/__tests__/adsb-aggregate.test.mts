import assert from 'node:assert/strict';
import test from 'node:test';

import {
  mergeAdsbProviders,
  type AdsbProviderSnapshot,
} from '../adsb-aggregate.ts';

const NOW = 1_745_000_000_000;
const SEC = 1000;

function snap(overrides: Partial<AdsbProviderSnapshot> = {}): AdsbProviderSnapshot {
  return {
    providerId: 'opensky',
    fetchedAt: NOW,
    aircraft: [],
    ...overrides,
  };
}

// ── Single-provider track ──────────────────────────────────────────────

test('single provider produces tracks with confidence 0.55', () => {
  const r = mergeAdsbProviders(
    [snap({ aircraft: [{ hex: 'A1B2C3', lat: 40, lng: -100, observedAt: NOW }] })],
    { generatedAt: NOW },
  );
  assert.equal(r.tracks.length, 1);
  assert.equal(r.tracks[0]?.hex, 'a1b2c3');
  assert.ok(Math.abs((r.tracks[0]?.confidence ?? 0) - 0.55) < 1e-9);
  assert.equal(r.tracks[0]?.providers[0], 'opensky');
});

// ── Multi-provider merge ───────────────────────────────────────────────

test('two providers reporting same aircraft → confidence 0.85', () => {
  const r = mergeAdsbProviders(
    [
      snap({ providerId: 'opensky', aircraft: [{ hex: 'A1', lat: 40, lng: -100, observedAt: NOW }] }),
      snap({ providerId: 'adsbexchange', aircraft: [{ hex: 'A1', lat: 40.001, lng: -100.001, observedAt: NOW }] }),
    ],
    { generatedAt: NOW },
  );
  assert.equal(r.tracks.length, 1);
  assert.ok(Math.abs((r.tracks[0]?.confidence ?? 0) - 0.85) < 1e-9);
  assert.equal(r.tracks[0]?.providers.length, 2);
});

test('three+ providers → confidence 0.95', () => {
  const r = mergeAdsbProviders(
    [
      snap({ providerId: 'opensky', aircraft: [{ hex: 'A1', lat: 40, lng: -100, observedAt: NOW }] }),
      snap({ providerId: 'adsbexchange', aircraft: [{ hex: 'A1', lat: 40, lng: -100, observedAt: NOW }] }),
      snap({ providerId: 'wingbits', aircraft: [{ hex: 'A1', lat: 40, lng: -100, observedAt: NOW }] }),
    ],
    { generatedAt: NOW },
  );
  assert.ok(Math.abs((r.tracks[0]?.confidence ?? 0) - 0.95) < 1e-9);
});

// ── Position selection ─────────────────────────────────────────────────

test('freshest report wins on position', () => {
  const r = mergeAdsbProviders(
    [
      snap({ providerId: 'opensky', aircraft: [{ hex: 'A1', lat: 40, lng: -100, observedAt: NOW - 10 * SEC }] }),
      snap({ providerId: 'adsbexchange', aircraft: [{ hex: 'A1', lat: 41, lng: -101, observedAt: NOW }] }),
    ],
    { generatedAt: NOW },
  );
  assert.equal(r.tracks[0]?.lat, 41);
  assert.equal(r.tracks[0]?.lng, -101);
});

test('higher-weight provider wins ties on freshness', () => {
  const r = mergeAdsbProviders(
    [
      snap({ providerId: 'opensky', weight: 1, aircraft: [{ hex: 'A1', lat: 40, lng: -100, observedAt: NOW }] }),
      snap({ providerId: 'wingbits', weight: 2, aircraft: [{ hex: 'A1', lat: 41, lng: -101, observedAt: NOW }] }),
    ],
    { generatedAt: NOW },
  );
  assert.equal(r.tracks[0]?.providers[0], 'wingbits');
});

// ── Callsign falls back across providers ──────────────────────────────

test('callsign carried over from any provider that has it', () => {
  const r = mergeAdsbProviders(
    [
      snap({ providerId: 'opensky', aircraft: [{ hex: 'A1', lat: 40, lng: -100, observedAt: NOW }] }),
      snap({ providerId: 'adsbexchange', aircraft: [{ hex: 'A1', lat: 40, lng: -100, observedAt: NOW, callsign: 'AAL123' }] }),
    ],
    { generatedAt: NOW },
  );
  assert.equal(r.tracks[0]?.callsign, 'AAL123');
});

// ── Confidence decay + degraded providers ─────────────────────────────

test('confidence decays after 60s of staleness', () => {
  const r = mergeAdsbProviders(
    [snap({ aircraft: [{ hex: 'A1', lat: 40, lng: -100, observedAt: NOW - 180 * SEC }] })],
    { generatedAt: NOW },
  );
  // 180 s old, 1 provider → base 0.55 × decay
  assert.ok((r.tracks[0]?.confidence ?? 1) < 0.55);
});

test('confidence fully decays to 0 by 5 min stale — no 50% floor (round-1 #28)', () => {
  const at5min = mergeAdsbProviders(
    [snap({ aircraft: [{ hex: 'A1', lat: 40, lng: -100, observedAt: NOW - 300 * SEC }] })],
    { generatedAt: NOW },
  );
  assert.ok(Math.abs(at5min.tracks[0]?.confidence ?? 1) < 1e-9, '5-min-stale track must reach 0 confidence');
  // And it stays at 0 well past 5 min (previously it floored at 50% of base forever).
  const at12min = mergeAdsbProviders(
    [snap({ aircraft: [{ hex: 'A1', lat: 40, lng: -100, observedAt: NOW - 720 * SEC }] })],
    { generatedAt: NOW },
  );
  assert.ok(Math.abs(at12min.tracks[0]?.confidence ?? 1) < 1e-9, '12-min-stale track must stay at 0, not 50%');
});

test('all-degraded providers cap track confidence at 0.6', () => {
  const r = mergeAdsbProviders(
    [
      snap({ providerId: 'a', degraded: true, aircraft: [{ hex: 'A1', lat: 40, lng: -100, observedAt: NOW }] }),
      snap({ providerId: 'b', degraded: true, aircraft: [{ hex: 'A1', lat: 40, lng: -100, observedAt: NOW }] }),
    ],
    { generatedAt: NOW },
  );
  assert.ok((r.tracks[0]?.confidence ?? 0) <= 0.6);
});

// ── Provider freshness summary ─────────────────────────────────────────

test('providerFreshness reports per-provider age and degradation flag', () => {
  const r = mergeAdsbProviders(
    [
      snap({ providerId: 'opensky', fetchedAt: NOW - 10 * SEC, aircraft: [{ hex: 'a', lat: 40, lng: -100, observedAt: NOW - 10 * SEC }] }),
      snap({ providerId: 'adsbexchange', fetchedAt: NOW - 90 * SEC, aircraft: [{ hex: 'b', lat: 41, lng: -101, observedAt: NOW - 90 * SEC }] }),
    ],
    { generatedAt: NOW },
  );
  const opensky = r.providerFreshness.find((f) => f.providerId === 'opensky');
  const exchange = r.providerFreshness.find((f) => f.providerId === 'adsbexchange');
  assert.equal(opensky?.degraded, false);
  // Past stale threshold (60s default)
  assert.equal(exchange?.degraded, true);
});

// ── Status decisions ───────────────────────────────────────────────────

test('all providers fresh → status healthy', () => {
  const r = mergeAdsbProviders(
    [
      snap({ providerId: 'opensky', fetchedAt: NOW, aircraft: [] }),
      snap({ providerId: 'adsbexchange', fetchedAt: NOW, aircraft: [] }),
    ],
    { generatedAt: NOW },
  );
  assert.equal(r.status, 'healthy');
});

test('all providers stale → status silent only after silent threshold', () => {
  const r = mergeAdsbProviders(
    [snap({ providerId: 'opensky', fetchedAt: NOW - 6 * 60 * SEC, aircraft: [] })],
    { generatedAt: NOW },
  );
  assert.equal(r.status, 'silent');
});

test('one provider degraded → status degraded with reason naming the stale provider', () => {
  const r = mergeAdsbProviders(
    [
      snap({ providerId: 'opensky', fetchedAt: NOW, aircraft: [] }),
      snap({ providerId: 'adsbexchange', fetchedAt: NOW - 90 * SEC, aircraft: [] }),
    ],
    { generatedAt: NOW },
  );
  assert.equal(r.status, 'degraded');
  assert.match(r.reason, /Stale.*adsbexchange/);
});

// ── JSON ───────────────────────────────────────────────────────────────

test('aggregate is JSON-serializable', () => {
  const r = mergeAdsbProviders(
    [snap({ aircraft: [{ hex: 'a', lat: 40, lng: -100, observedAt: NOW }] })],
    { generatedAt: NOW },
  );
  const parsed = JSON.parse(JSON.stringify(r)) as { tracks: unknown[] };
  assert.equal(parsed.tracks.length, 1);
});

// ── Hex canonicalization ───────────────────────────────────────────────

test('hex is canonicalized to lowercase', () => {
  const r = mergeAdsbProviders(
    [snap({ aircraft: [{ hex: 'AB12CD', lat: 40, lng: -100, observedAt: NOW }] })],
    { generatedAt: NOW },
  );
  assert.equal(r.tracks[0]?.hex, 'ab12cd');
});

test('mixed-case hex from different providers merges as one track', () => {
  const r = mergeAdsbProviders(
    [
      snap({ providerId: 'a', aircraft: [{ hex: 'AB12CD', lat: 40, lng: -100, observedAt: NOW }] }),
      snap({ providerId: 'b', aircraft: [{ hex: 'ab12cd', lat: 40, lng: -100, observedAt: NOW }] }),
    ],
    { generatedAt: NOW },
  );
  assert.equal(r.tracks.length, 1);
  assert.equal(r.tracks[0]?.providers.length, 2);
});
