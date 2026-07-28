// src/services/survival/__tests__/grid-down-certify.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { certifyGridDown } from '../grid-down-certify.ts';
import { bandForLevel, SURVIVAL_AXES } from '../survival-types.ts';
import type {
  AxisState, DomainFreshness, PostureThreat, SurvivalAxis, SurvivalPosture, WorldSnapshot,
} from '../survival-types.ts';

const CAP = 1_700_000_000_000;
const HOUR = 3_600_000;

function threat(axis: SurvivalAxis, severity: number): PostureThreat {
  return {
    sourceEventId: 'e1', axis, severity, threatLevel: 'warning', hazardKind: 'tornado',
    hazardLabel: 'Tornado Warning', timeToImpactMins: 30, arrivalLabel: '30 min',
    why: 'polygon over saved place', confidenceLabel: 'high',
  };
}

function axisState(axis: SurvivalAxis, level: number, opts: { threats?: PostureThreat[]; drivers?: string[] } = {}): AxisState {
  const threats = opts.threats ?? [];
  const drivers = opts.drivers ?? [];
  return {
    axis, level, band: bandForLevel(level), trend: 'steady', threats,
    confidence: { total: level, max: 100, items: [{ label: 'x', value: level, max: 100, polarity: 'negative' }] },
    explanation: { headline: `${axis}`, lines: [], missingConfirmation: [] },
    drivers,
  };
}

/** Build a posture over the eight axes; `overrides` replaces specific axes. */
function posture(overrides: Partial<Record<SurvivalAxis, AxisState>> = {}, capturedAtMs = CAP): SurvivalPosture {
  const axes = SURVIVAL_AXES.map((a) => overrides[a] ?? axisState(a, 0));
  const worst = axes.reduce((m, a) => (a.level > m.level ? a : m), axes[0]!);
  return {
    axes, overallLevel: worst.level, overallBand: worst.band, worstAxis: worst.axis,
    headline: 'x', capturedAtMs, staleInputs: [],
  };
}

function snapshot(p: SurvivalPosture, freshness: DomainFreshness[] = [], capturedAtMs = CAP): WorldSnapshot {
  return { version: 1, capturedAtMs, freshness, weatherAlerts: [], savedPlaces: [], posture: p, plan: { committed: [] } };
}

/** A posture missing one axis entirely (for blind tests). */
function postureMissing(axis: SurvivalAxis): SurvivalPosture {
  const p = posture();
  return { ...p, axes: p.axes.filter((a) => a.axis !== axis) };
}

test('an all-secure fresh snapshot certifies with every axis ready', () => {
  const c = certifyGridDown(snapshot(posture()), { now: CAP });
  assert.equal(c.certified, true);
  assert.equal(c.axisVerdicts.length, SURVIVAL_AXES.length);
  assert.ok(c.axisVerdicts.every((v) => v.status === 'ready'));
  assert.equal(c.blindAxes.length, 0);
  assert.equal(c.headline, `Grid-down certified — all ${SURVIVAL_AXES.length} axes render and act fully offline.`);
});

test('an axis absent from the snapshot is blind and blocks certification', () => {
  const c = certifyGridDown(snapshot(postureMissing('comms')), { now: CAP });
  const comms = c.axisVerdicts.find((v) => v.axis === 'comms')!;
  assert.equal(comms.status, 'blind');
  assert.equal(comms.readable, false);
  assert.deepEqual(c.blindAxes, ['comms']);
  assert.equal(c.certified, false);
  assert.match(c.headline, /^Not grid-down certified — Comms is blind offline/);
});

test('an elevated axis with no threat or driver is a guidance gap → degraded, not certified', () => {
  const c = certifyGridDown(snapshot(posture({ supply: axisState('supply', 70) })), { now: CAP });
  const supply = c.axisVerdicts.find((v) => v.axis === 'supply')!;
  assert.equal(supply.status, 'degraded');
  assert.equal(supply.needsGuidance, true);
  assert.equal(supply.hasGuidance, false);
  assert.deepEqual(c.guidanceGapAxes, ['supply']);
  assert.equal(c.certified, false);
  assert.match(c.headline, /Supply is elevated with no offline play/);
});

test('an elevated axis WITH drivers has an offline play → ready and certified', () => {
  const c = certifyGridDown(
    snapshot(posture({ supply: axisState('supply', 70, { drivers: ['grain export halt'] }) })),
    { now: CAP },
  );
  const supply = c.axisVerdicts.find((v) => v.axis === 'supply')!;
  assert.equal(supply.status, 'ready');
  assert.equal(supply.hasGuidance, true);
  assert.equal(c.certified, true);
});

test('an elevated axis with active threats has an offline play', () => {
  const c = certifyGridDown(
    snapshot(posture({ physical_safety: axisState('physical_safety', 85, { threats: [threat('physical_safety', 85)] }) })),
    { now: CAP },
  );
  const ps = c.axisVerdicts.find((v) => v.axis === 'physical_safety')!;
  assert.equal(ps.hasGuidance, true);
  assert.equal(ps.status, 'ready');
  assert.equal(c.certified, true);
});

test('stale-but-readable data degrades an axis yet still certifies', () => {
  const now = CAP + 8 * HOUR; // past the 6h stale flag, within the 24h blind horizon
  const c = certifyGridDown(snapshot(posture()), { now });
  assert.ok(c.axisVerdicts.every((v) => v.status === 'degraded' && v.stale));
  assert.equal(c.staleAxes.length, SURVIVAL_AXES.length);
  assert.equal(c.certified, true);
  assert.match(c.headline, /Grid-down certified.*on stale data\.$/);
});

test('data past the blind horizon is treated as blind and blocks certification', () => {
  const now = CAP + 30 * HOUR; // past the 24h blind horizon
  const c = certifyGridDown(snapshot(posture()), { now });
  assert.ok(c.axisVerdicts.every((v) => v.status === 'blind'));
  assert.equal(c.blindAxes.length, SURVIVAL_AXES.length);
  assert.equal(c.certified, false);
});

test('per-axis freshness: weather-backed physical_safety ages on the weather feed, not the capture time', () => {
  // Capture is fresh, but the weather feed behind physical_safety is 9h stale.
  const fresh: DomainFreshness[] = [{ domain: 'weather', fetchedAtMs: CAP - 9 * HOUR, ageMs: 9 * HOUR, ok: false }];
  const c = certifyGridDown(snapshot(posture(), fresh), { now: CAP });
  const ps = c.axisVerdicts.find((v) => v.axis === 'physical_safety')!;
  const supply = c.axisVerdicts.find((v) => v.axis === 'supply')!;
  assert.equal(ps.stale, true);
  assert.equal(ps.status, 'degraded');
  assert.equal(supply.stale, false); // supply falls back to the fresh capture time
  assert.equal(supply.status, 'ready');
});

test('a blind axis takes headline priority over a guidance gap', () => {
  const p = posture({ supply: axisState('supply', 70) }); // guidance gap
  const c = certifyGridDown(snapshot(postureMissingFrom(p, 'comms')), { now: CAP });
  assert.ok(c.blindAxes.includes('comms'));
  assert.ok(c.guidanceGapAxes.includes('supply'));
  assert.match(c.headline, /is blind offline/);
});

test('the headline names a blind axis and counts the rest', () => {
  let p = posture();
  p = postureMissingFrom(p, 'security');
  p = postureMissingFrom(p, 'health');
  const c = certifyGridDown(snapshot(p), { now: CAP });
  assert.equal(c.blindAxes.length, 2);
  assert.match(c.headline, /(Health|Security) is blind offline \(\+1 more\)\.$/);
});

test('custom stale/blind horizons are honored', () => {
  const now = CAP + 2 * HOUR;
  const c = certifyGridDown(snapshot(posture()), { now, staleAfterMs: HOUR, blindAfterMs: 90 * 60_000 });
  // 2h old: past both a 1h stale and a 1.5h blind horizon → blind.
  assert.ok(c.axisVerdicts.every((v) => v.status === 'blind'));
});

test('a blind horizon below the stale horizon is floored up to it', () => {
  const now = CAP + 3 * HOUR;
  // blindAfter (1h) < staleAfter (6h) → floored to 6h; 3h old is within both,
  // so the axis is ready rather than the blind a literal 1h horizon would force.
  const c = certifyGridDown(snapshot(posture()), { now, blindAfterMs: HOUR });
  assert.ok(c.axisVerdicts.every((v) => v.status === 'ready'));
  assert.equal(c.certified, true);
});

test('level exactly at the guidance threshold needs an offline play', () => {
  const c = certifyGridDown(snapshot(posture({ mobility: axisState('mobility', 40) })), { now: CAP });
  const mob = c.axisVerdicts.find((v) => v.axis === 'mobility')!;
  assert.equal(mob.needsGuidance, true);
  assert.equal(mob.status, 'degraded'); // no driver → gap
});

test('a low but non-secure axis below the guidance threshold needs no offline play', () => {
  const c = certifyGridDown(snapshot(posture({ mobility: axisState('mobility', 39) })), { now: CAP });
  const mob = c.axisVerdicts.find((v) => v.axis === 'mobility')!;
  assert.equal(mob.needsGuidance, false);
  assert.equal(mob.status, 'ready');
  assert.equal(c.certified, true);
});

test('now earlier than capture never yields a negative data age', () => {
  const c = certifyGridDown(snapshot(posture()), { now: CAP - 5 * HOUR });
  assert.ok(c.axisVerdicts.every((v) => v.dataAgeMs === 0));
  assert.equal(c.certified, true);
});

test('non-finite level and capture time never leak NaN into verdicts', () => {
  const p = posture({ supply: axisState('supply', Number.NaN) });
  const c = certifyGridDown(snapshot({ ...p, capturedAtMs: Number.NaN }, [], Number.NaN), { now: CAP });
  for (const v of c.axisVerdicts) {
    assert.ok(Number.isFinite(v.level));
    assert.ok(Number.isFinite(v.dataAgeMs));
  }
});

test('a non-finite now does not leak NaN and does not certify a dead snapshot fail-open', () => {
  // A NaN clock falls back to the capture time (snapshot assumed current),
  // matching the no-now default — never NaN ages that silently pass every check.
  const nan = certifyGridDown(snapshot(posture()), { now: Number.NaN });
  const dflt = certifyGridDown(snapshot(posture()));
  assert.ok(nan.axisVerdicts.every((v) => Number.isFinite(v.dataAgeMs)));
  assert.equal(nan.certified, dflt.certified);
  assert.deepEqual(nan.axisVerdicts.map((v) => v.status), dflt.axisVerdicts.map((v) => v.status));
});

test('an out-of-range axis level is clamped into 0..100', () => {
  const c = certifyGridDown(snapshot(posture({
    supply: axisState('supply', 250, { drivers: ['x'] }),
    health: axisState('health', -30),
  })), { now: CAP });
  const supply = c.axisVerdicts.find((v) => v.axis === 'supply')!;
  const health = c.axisVerdicts.find((v) => v.axis === 'health')!;
  assert.equal(supply.level, 100);
  assert.equal(health.level, 0);
});

test('negative horizons are floored so nothing is spuriously blind', () => {
  const c = certifyGridDown(snapshot(posture()), { now: CAP, staleAfterMs: -5, blindAfterMs: -10 });
  // Floored to 0: with now === capture, ages are 0, so 0 is not "> 0" → ready.
  assert.ok(c.axisVerdicts.every((v) => v.status === 'ready'));
  assert.equal(c.certified, true);
});

/** Rebuild a posture with one axis removed (keeps overrides applied earlier). */
function postureMissingFrom(p: SurvivalPosture, axis: SurvivalAxis): SurvivalPosture {
  return { ...p, axes: p.axes.filter((a) => a.axis !== axis) };
}
