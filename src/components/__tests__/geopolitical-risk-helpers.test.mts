import assert from 'node:assert/strict';
import test from 'node:test';

import {
  severityToScore,
  riskTier,
  freshnessMultiplier,
  scoreCountryRisks,
  normalizeCountryCode,
  regionLabel,
  regionOf,
  scoreRegionRisks,
  scoreGreatPowerDyads,
  GREAT_POWERS,
  eventToRiskSignal,
  eventsToRiskSignals,
  formatTimeAgo,
  buildGeopoliticalRiskState,
  renderGeopoliticalRiskHtml,
  ALL_DIMENSIONS,
  DIMENSION_WEIGHTS,
  type RiskSignal,
  type RiskDimension,
} from '../geopolitical-risk-helpers.ts';
import type { ObservationEvent, ObservationSeverity } from '@/types/intelligence';

const NOW = Date.parse('2026-05-26T12:00:00Z');
const DAY_MS = 86_400_000;

function signal(over: Partial<RiskSignal> = {}): RiskSignal {
  return {
    dimension: over.dimension ?? 'coup-instability',
    countryCodes: over.countryCodes ?? ['SD'],
    severity: over.severity ?? 'HIGH',
    observedAt: over.observedAt ?? NOW,
    label: over.label ?? 'test label',
    sourceId: over.sourceId,
  };
}

function obs(over: Partial<ObservationEvent> = {}): ObservationEvent {
  return {
    id: over.id ?? 'ev-1',
    sourceId: over.sourceId ?? 'test',
    domain: over.domain ?? 'geopolitical',
    timestamp: over.timestamp ?? NOW,
    severity: over.severity ?? 'HIGH',
    title: over.title ?? 'Test event',
    raw: over.raw ?? {},
    entityIds: over.entityIds ?? [],
    tags: over.tags ?? [],
    location: over.location,
  };
}

// ── severityToScore ────────────────────────────────────────────────

test('severityToScore covers every level', () => {
  assert.equal(severityToScore('INFO'), 0);
  assert.equal(severityToScore('LOW'), 2);
  assert.equal(severityToScore('MEDIUM'), 5);
  assert.equal(severityToScore('HIGH'), 7);
  assert.equal(severityToScore('CRITICAL'), 9);
});

test('severityToScore falls back to 0 for unknown values', () => {
  assert.equal(severityToScore('GARBAGE' as ObservationSeverity), 0);
});

// ── riskTier ───────────────────────────────────────────────────────

test('riskTier hits each band boundary', () => {
  assert.equal(riskTier(0), 'low');
  assert.equal(riskTier(20), 'watch');
  assert.equal(riskTier(40), 'elevated');
  assert.equal(riskTier(60), 'high');
  assert.equal(riskTier(80), 'critical');
});

test('riskTier rounds down within bands', () => {
  assert.equal(riskTier(19), 'low');
  assert.equal(riskTier(39), 'watch');
  assert.equal(riskTier(59), 'elevated');
  assert.equal(riskTier(79), 'high');
});

// ── freshnessMultiplier ────────────────────────────────────────────

test('freshnessMultiplier returns 1 for now', () => {
  assert.equal(freshnessMultiplier(NOW, NOW), 1);
});

test('freshnessMultiplier halves at 14 days', () => {
  const m = freshnessMultiplier(NOW - 14 * DAY_MS, NOW);
  assert.ok(Math.abs(m - 0.5) < 1e-6, `expected ~0.5, got ${m}`);
});

test('freshnessMultiplier floors at 0.05 for very old signals', () => {
  const m = freshnessMultiplier(NOW - 365 * DAY_MS, NOW);
  assert.equal(m, 0.05);
});

test('freshnessMultiplier never returns 0', () => {
  const m = freshnessMultiplier(NOW - 10_000 * DAY_MS, NOW);
  assert.ok(m > 0);
});

// ── normalizeCountryCode ──────────────────────────────────────────

test('normalizeCountryCode accepts ISO-2 uppercase', () => {
  assert.equal(normalizeCountryCode('US'), 'US');
});

test('normalizeCountryCode upper-cases and trims', () => {
  assert.equal(normalizeCountryCode('  us  '), 'US');
});

test('normalizeCountryCode rejects non-ISO-2 strings', () => {
  assert.equal(normalizeCountryCode('USA'), null);
  assert.equal(normalizeCountryCode('U'), null);
  assert.equal(normalizeCountryCode('12'), null);
});

test('normalizeCountryCode rejects non-string input', () => {
  assert.equal(normalizeCountryCode(42 as unknown as string), null);
});

// ── DIMENSION_WEIGHTS invariants ───────────────────────────────────

test('DIMENSION_WEIGHTS sums to 1 (within float epsilon)', () => {
  let total = 0;
  for (const d of ALL_DIMENSIONS) total += DIMENSION_WEIGHTS[d];
  assert.ok(Math.abs(total - 1) < 1e-9, `weights sum to ${total}`);
});

test('DIMENSION_WEIGHTS defines every dimension', () => {
  for (const d of ALL_DIMENSIONS) {
    assert.ok(DIMENSION_WEIGHTS[d] > 0, `missing weight for ${d}`);
  }
});

// ── scoreCountryRisks ──────────────────────────────────────────────

test('scoreCountryRisks returns empty for no signals', () => {
  assert.deepEqual(scoreCountryRisks([], NOW), []);
});

test('scoreCountryRisks groups signals by country', () => {
  const out = scoreCountryRisks([
    signal({ countryCodes: ['US'] }),
    signal({ countryCodes: ['CN'] }),
    signal({ countryCodes: ['US'] }),
  ], NOW);
  assert.equal(out.length, 2);
  const us = out.find((c) => c.countryCode === 'US');
  assert.ok(us);
  assert.equal(us!.signalCount, 2);
});

test('scoreCountryRisks sorts by composite score descending', () => {
  const out = scoreCountryRisks([
    signal({ countryCodes: ['LO'], dimension: 'alliance-shift', severity: 'LOW' }),
    signal({ countryCodes: ['HI'], dimension: 'coup-instability', severity: 'CRITICAL' }),
  ], NOW);
  assert.equal(out[0]!.countryCode, 'HI');
  assert.ok(out[0]!.score > out[1]!.score);
});

test('scoreCountryRisks assigns tiers from composite scores', () => {
  const out = scoreCountryRisks([
    signal({
      countryCodes: ['SO'],
      dimension: 'coup-instability',
      severity: 'CRITICAL',
    }),
    signal({
      countryCodes: ['SO'],
      dimension: 'great-power-competition',
      severity: 'CRITICAL',
    }),
    signal({
      countryCodes: ['SO'],
      dimension: 'sanctions-regime',
      severity: 'CRITICAL',
    }),
  ], NOW);
  assert.equal(out[0]!.countryCode, 'SO');
  assert.equal(out[0]!.tier, 'elevated');
  assert.ok(out[0]!.score >= 40);
});

test('scoreCountryRisks decays older signals so they score less', () => {
  const recent = scoreCountryRisks([
    signal({ countryCodes: ['XA'], dimension: 'sanctions-regime', severity: 'HIGH', observedAt: NOW }),
  ], NOW);
  const old = scoreCountryRisks([
    signal({ countryCodes: ['XA'], dimension: 'sanctions-regime', severity: 'HIGH', observedAt: NOW - 60 * DAY_MS }),
  ], NOW);
  assert.ok(recent[0]!.score >= old[0]!.score);
});

test('scoreCountryRisks records lastUpdated as the most recent signal', () => {
  const out = scoreCountryRisks([
    signal({ countryCodes: ['XB'], observedAt: NOW - 5 * DAY_MS }),
    signal({ countryCodes: ['XB'], observedAt: NOW }),
    signal({ countryCodes: ['XB'], observedAt: NOW - 10 * DAY_MS }),
  ], NOW);
  assert.equal(out[0]!.lastUpdated, NOW);
});

test('scoreCountryRisks builds dimension breakdowns sorted by weighted score', () => {
  const out = scoreCountryRisks([
    signal({ countryCodes: ['XC'], dimension: 'coup-instability', severity: 'CRITICAL' }),
    signal({ countryCodes: ['XC'], dimension: 'alliance-shift', severity: 'LOW' }),
  ], NOW);
  const breakdowns = out[0]!.byDimension;
  assert.equal(breakdowns[0]!.dimension, 'coup-instability');
});

test('scoreCountryRisks rejects invalid country codes', () => {
  const out = scoreCountryRisks([
    signal({ countryCodes: ['USA', '12', 'US'] }),
  ], NOW);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.countryCode, 'US');
});

test('scoreCountryRisks fills topDrivers using highest-severity labels', () => {
  const out = scoreCountryRisks([
    signal({ countryCodes: ['XD'], dimension: 'coup-instability', severity: 'CRITICAL', label: 'coup attempt' }),
    signal({ countryCodes: ['XD'], dimension: 'sanctions-regime', severity: 'MEDIUM', label: 'asset freeze' }),
  ], NOW);
  assert.ok(out[0]!.topDrivers.some((d) => d.includes('coup attempt')));
});

// ── regionOf / regionLabel / scoreRegionRisks ─────────────────────

test('regionOf maps known countries', () => {
  assert.equal(regionOf('US'), 'north-america');
  assert.equal(regionOf('CN'), 'east-asia');
  assert.equal(regionOf('RU'), 'former-soviet');
  assert.equal(regionOf('NG'), 'africa');
});

test('regionOf returns other for unmapped', () => {
  assert.equal(regionOf('ZZ'), 'other');
});

test('regionLabel returns human-readable strings', () => {
  assert.equal(regionLabel('north-america'), 'North America');
  assert.equal(regionLabel('former-soviet'), 'Former Soviet');
});

test('scoreRegionRisks groups countries by region', () => {
  const countries = scoreCountryRisks([
    signal({ countryCodes: ['US'], dimension: 'great-power-competition', severity: 'HIGH' }),
    signal({ countryCodes: ['CA'], dimension: 'alliance-shift', severity: 'LOW' }),
    signal({ countryCodes: ['CN'], dimension: 'territorial-dispute', severity: 'HIGH' }),
  ], NOW);
  const regions = scoreRegionRisks(countries);
  const na = regions.find((r) => r.region === 'north-america');
  assert.ok(na);
  assert.equal(na!.countryCount, 2);
});

test('scoreRegionRisks weights the worst country most heavily', () => {
  const countries = scoreCountryRisks([
    signal({ countryCodes: ['XE'], dimension: 'coup-instability', severity: 'CRITICAL' }),
    signal({ countryCodes: ['XE'], dimension: 'great-power-competition', severity: 'CRITICAL' }),
    signal({ countryCodes: ['XF'], dimension: 'alliance-shift', severity: 'LOW' }),
  ], NOW);
  const regions = scoreRegionRisks(countries);
  // XE/XF land in 'other'; the region should reflect the worst (XE) more than the mean.
  const other = regions.find((r) => r.region === 'other');
  assert.ok(other);
  assert.ok(other!.score >= countries.find((c) => c.countryCode === 'XF')!.score);
});

test('scoreRegionRisks reports up to 3 top countries', () => {
  const countries = scoreCountryRisks(
    Array.from({ length: 6 }, (_, i) =>
      signal({
        countryCodes: [String.fromCharCode(65 + i) + 'A'],
        dimension: 'coup-instability',
        severity: 'HIGH',
      })),
    NOW);
  const regions = scoreRegionRisks(countries);
  for (const r of regions) {
    assert.ok(r.topCountries.length <= 3);
  }
});

// ── scoreGreatPowerDyads ──────────────────────────────────────────

test('scoreGreatPowerDyads returns all unordered pairs', () => {
  const dyads = scoreGreatPowerDyads([], NOW);
  const expected = (GREAT_POWERS.length * (GREAT_POWERS.length - 1)) / 2;
  assert.equal(dyads.length, expected);
});

test('scoreGreatPowerDyads scores zero when no shared signals', () => {
  const dyads = scoreGreatPowerDyads([
    signal({ countryCodes: ['US'], dimension: 'great-power-competition', severity: 'HIGH' }),
  ], NOW);
  for (const d of dyads) assert.equal(d.score, 0);
});

test('scoreGreatPowerDyads picks up bilateral signals', () => {
  const dyads = scoreGreatPowerDyads([
    signal({
      countryCodes: ['US', 'CN'],
      dimension: 'great-power-competition',
      severity: 'CRITICAL',
      label: 'FONOPS escalation',
    }),
  ], NOW);
  const usCn = dyads.find((d) => (d.a === 'US' && d.b === 'CN') || (d.a === 'CN' && d.b === 'US'));
  assert.ok(usCn);
  assert.ok(usCn!.score >= 80);
  assert.ok(usCn!.topDrivers.includes('FONOPS escalation'));
});

test('scoreGreatPowerDyads recognizes EU via member states', () => {
  const dyads = scoreGreatPowerDyads([
    signal({
      countryCodes: ['DE', 'RU'],
      dimension: 'diplomatic-crisis',
      severity: 'HIGH',
      label: 'expulsions',
    }),
  ], NOW);
  const euRu = dyads.find((d) =>
    (d.a === 'EU' && d.b === 'RU') || (d.a === 'RU' && d.b === 'EU'));
  assert.ok(euRu);
  assert.ok(euRu!.signalCount >= 1);
});

test('scoreGreatPowerDyads ignores non-competition dimensions', () => {
  const dyads = scoreGreatPowerDyads([
    signal({
      countryCodes: ['US', 'CN'],
      dimension: 'coup-instability',
      severity: 'CRITICAL',
    }),
  ], NOW);
  const usCn = dyads.find((d) =>
    (d.a === 'US' && d.b === 'CN') || (d.a === 'CN' && d.b === 'US'));
  assert.equal(usCn!.score, 0);
});

// ── eventToRiskSignal ─────────────────────────────────────────────

test('eventToRiskSignal converts well-tagged events', () => {
  const s = eventToRiskSignal(obs({
    tags: ['coup', 'country:SD'],
    severity: 'CRITICAL',
    title: 'Sudan coup',
  }));
  assert.ok(s);
  assert.equal(s!.dimension, 'coup-instability');
  assert.deepEqual(s!.countryCodes, ['SD']);
});

test('eventToRiskSignal pulls country codes from entityIds', () => {
  const s = eventToRiskSignal(obs({
    tags: ['sanctions'],
    entityIds: ['RU'],
  }));
  assert.ok(s);
  assert.deepEqual(s!.countryCodes, ['RU']);
});

test('eventToRiskSignal returns null without a dimension tag', () => {
  assert.equal(eventToRiskSignal(obs({ tags: ['country:US'] })), null);
});

test('eventToRiskSignal returns null without any country', () => {
  assert.equal(eventToRiskSignal(obs({ tags: ['coup'] })), null);
});

test('eventToRiskSignal de-dupes country codes across tags + entityIds', () => {
  const s = eventToRiskSignal(obs({
    tags: ['coup', 'country:SD'],
    entityIds: ['SD', 'sd'],
  }));
  assert.equal(s!.countryCodes.length, 1);
});

test('eventsToRiskSignals drops un-tagged events silently', () => {
  const out = eventsToRiskSignals([
    obs({ tags: ['coup', 'country:VE'] }),
    obs({ tags: [] }),
    obs({ tags: ['sanctions', 'country:IR'] }),
  ]);
  assert.equal(out.length, 2);
});

// ── formatTimeAgo ─────────────────────────────────────────────────

test('formatTimeAgo seconds < minute', () => {
  assert.equal(formatTimeAgo(NOW - 15_000, NOW), '15s ago');
});

test('formatTimeAgo minutes < hour', () => {
  assert.equal(formatTimeAgo(NOW - 5 * 60_000, NOW), '5m ago');
});

test('formatTimeAgo hours < day', () => {
  assert.equal(formatTimeAgo(NOW - 4 * 3_600_000, NOW), '4h ago');
});

test('formatTimeAgo days for older timestamps', () => {
  assert.equal(formatTimeAgo(NOW - 3 * DAY_MS, NOW), '3d ago');
});

test('formatTimeAgo handles future timestamps', () => {
  assert.equal(formatTimeAgo(NOW + 60_000, NOW), 'just now');
});

// ── buildGeopoliticalRiskState + renderGeopoliticalRiskHtml ──────

test('buildGeopoliticalRiskState composes every section', () => {
  const state = buildGeopoliticalRiskState({
    signals: [
      signal({ countryCodes: ['US', 'CN'], dimension: 'great-power-competition', severity: 'CRITICAL' }),
      signal({ countryCodes: ['SD'], dimension: 'coup-instability', severity: 'HIGH' }),
    ],
  }, NOW);
  assert.equal(state.generatedAt, NOW);
  assert.ok(state.topCountries.length >= 1);
  assert.ok(state.regions.length >= 1);
  assert.ok(state.dyads.length > 0);
  assert.equal(state.signalCount, 2);
});

test('buildGeopoliticalRiskState respects countryLimit', () => {
  const sigs = Array.from({ length: 12 }, (_, i): RiskSignal =>
    signal({
      countryCodes: [String.fromCharCode(65 + i) + 'B'],
      dimension: ALL_DIMENSIONS[i % ALL_DIMENSIONS.length] as RiskDimension,
      severity: 'HIGH',
    }));
  const state = buildGeopoliticalRiskState({ signals: sigs, countryLimit: 5 }, NOW);
  assert.equal(state.topCountries.length, 5);
});

test('renderGeopoliticalRiskHtml includes section headers', () => {
  const state = buildGeopoliticalRiskState({
    signals: [
      signal({ countryCodes: ['IR'], dimension: 'sanctions-regime', severity: 'HIGH' }),
      signal({ countryCodes: ['US', 'RU'], dimension: 'diplomatic-crisis', severity: 'HIGH' }),
    ],
  }, NOW);
  const html = renderGeopoliticalRiskHtml(state, () => NOW);
  assert.match(html, /Geopolitical Risk Index/);
  assert.match(html, /Region Risk/);
  assert.match(html, /Top Countries/);
  assert.match(html, /Great-Power Competition/);
});

test('renderGeopoliticalRiskHtml escapes user-controlled text', () => {
  const state = buildGeopoliticalRiskState({
    signals: [signal({ countryCodes: ['US'], label: '<script>x</script>' })],
  }, NOW);
  const html = renderGeopoliticalRiskHtml(state, () => NOW);
  assert.ok(!html.includes('<script>x</script>'));
  assert.match(html, /&lt;script&gt;/);
});

test('renderGeopoliticalRiskHtml shows empty-state messages with no data', () => {
  const state = buildGeopoliticalRiskState({ signals: [] }, NOW);
  const html = renderGeopoliticalRiskHtml(state, () => NOW);
  assert.match(html, /No regional signals/);
  assert.match(html, /No country signals/);
  assert.match(html, /No tracked great-power tension/);
});
