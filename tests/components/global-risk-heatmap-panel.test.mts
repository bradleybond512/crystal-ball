import assert from 'node:assert/strict';
import test from 'node:test';

import {
  REGION_KEYS,
  DOMAIN_KEYS,
  REGION_LABEL,
  DOMAIN_LABEL,
  classifyRegion,
  classifyDomain,
  severityToBucket,
  emptyMatrix,
  aggregateHeatmap,
  totalEventCount,
  bucketLabel,
  type RegionKey,
  type DomainKey,
} from '../../src/components/global-risk-heatmap-utils.ts';
import type { ObservationEvent } from '../../src/types/intelligence.ts';

const NOW = 1_715_000_000_000;

function event(overrides: Partial<ObservationEvent> = {}): ObservationEvent {
  return {
    id: 'evt',
    sourceId: 'src',
    domain: 'seismic',
    timestamp: NOW,
    location: { lat: 35.68, lon: 139.65 },
    severity: 'MEDIUM',
    title: 't',
    raw: {},
    entityIds: [],
    tags: [],
    ...overrides,
  };
}

// ── Taxonomy (constants) ─────────────────────────────────────────────────

test('REGION_KEYS lists 9 regions in fixed order', () => {
  assert.equal(REGION_KEYS.length, 9);
  assert.equal(REGION_KEYS[0], 'north_america');
  assert.equal(REGION_KEYS.at(-1), 'arctic');
});

test('DOMAIN_KEYS lists 9 domains in fixed order', () => {
  assert.equal(DOMAIN_KEYS.length, 9);
  assert.equal(DOMAIN_KEYS[0], 'weather');
  assert.equal(DOMAIN_KEYS.at(-1), 'space');
});

test('REGION_LABEL covers every key', () => {
  for (const r of REGION_KEYS) assert.ok(REGION_LABEL[r], `missing label for ${r}`);
});

test('DOMAIN_LABEL covers every key', () => {
  for (const d of DOMAIN_KEYS) assert.ok(DOMAIN_LABEL[d], `missing label for ${d}`);
});

// ── classifyRegion ───────────────────────────────────────────────────────

test('classifyRegion: Arctic dominates above 66°N', () => {
  assert.equal(classifyRegion(70, 0), 'arctic');
  assert.equal(classifyRegion(70, -100), 'arctic');
});

test('classifyRegion: North America bbox (Denver)', () => {
  assert.equal(classifyRegion(39.74, -104.99), 'north_america');
});

test('classifyRegion: South America bbox (São Paulo)', () => {
  assert.equal(classifyRegion(-23.55, -46.63), 'south_america');
});

test('classifyRegion: Europe bbox (Berlin)', () => {
  assert.equal(classifyRegion(52.52, 13.40), 'europe');
});

test('classifyRegion: Middle East bbox (Tehran)', () => {
  assert.equal(classifyRegion(35.69, 51.39), 'middle_east');
});

test('classifyRegion: Africa bbox (Nairobi)', () => {
  assert.equal(classifyRegion(-1.29, 36.82), 'africa');
});

test('classifyRegion: South Asia bbox (Delhi)', () => {
  assert.equal(classifyRegion(28.61, 77.21), 'south_asia');
});

test('classifyRegion: East Asia bbox (Tokyo)', () => {
  assert.equal(classifyRegion(35.68, 139.65), 'east_asia');
});

test('classifyRegion: Pacific catch-all for Auckland', () => {
  assert.equal(classifyRegion(-36.85, 174.76), 'pacific');
});

test('classifyRegion: rejects non-finite coordinates', () => {
  assert.equal(classifyRegion(Number.NaN, 0), null);
  assert.equal(classifyRegion(0, Number.POSITIVE_INFINITY), null);
});

// ── classifyDomain ───────────────────────────────────────────────────────

test('classifyDomain: direct hits map verbatim', () => {
  assert.equal(classifyDomain('weather'), 'weather');
  assert.equal(classifyDomain('cyber'), 'cyber');
});

test('classifyDomain: case-insensitive', () => {
  assert.equal(classifyDomain('SEISMIC'), 'seismic');
  assert.equal(classifyDomain('Maritime'), 'maritime');
});

test('classifyDomain: aliases route correctly', () => {
  assert.equal(classifyDomain('earthquake'), 'seismic');
  assert.equal(classifyDomain('wildfire'), 'weather');
  assert.equal(classifyDomain('biosurveillance'), 'health');
  assert.equal(classifyDomain('ais'), 'maritime');
  assert.equal(classifyDomain('space_weather'), 'space');
});

test('classifyDomain: unknown returns null', () => {
  assert.equal(classifyDomain('mystery'), null);
});

// ── severityToBucket ─────────────────────────────────────────────────────

test('severityToBucket maps the 5-rung ladder to 0..4', () => {
  assert.equal(severityToBucket('INFO'), 0);
  assert.equal(severityToBucket('LOW'), 1);
  assert.equal(severityToBucket('MEDIUM'), 2);
  assert.equal(severityToBucket('HIGH'), 3);
  assert.equal(severityToBucket('CRITICAL'), 4);
});

test('severityToBucket: unknown → 0', () => {
  assert.equal(severityToBucket('garbage'), 0);
});

// ── emptyMatrix ──────────────────────────────────────────────────────────

test('emptyMatrix has 81 cells, all severity 0 / count 0', () => {
  const m = emptyMatrix();
  let cells = 0;
  for (const r of REGION_KEYS) for (const d of DOMAIN_KEYS) {
    cells += 1;
    assert.equal(m[r][d].severity, 0);
    assert.equal(m[r][d].count, 0);
    assert.equal(m[r][d].region, r);
    assert.equal(m[r][d].domain, d);
  }
  assert.equal(cells, 81);
});

// ── aggregateHeatmap ─────────────────────────────────────────────────────

test('aggregateHeatmap: empty input → empty matrix', () => {
  assert.equal(totalEventCount(aggregateHeatmap([])), 0);
});

test('aggregateHeatmap: bucketizes one Tokyo earthquake into east_asia/seismic', () => {
  const m = aggregateHeatmap([event({ domain: 'seismic', severity: 'HIGH' })]);
  assert.equal(m.east_asia.seismic.severity, 3);
  assert.equal(m.east_asia.seismic.count, 1);
  // Every other cell stays at 0.
  assert.equal(m.europe.cyber.count, 0);
});

test('aggregateHeatmap: highest severity wins for a (region, domain) cell', () => {
  const m = aggregateHeatmap([
    event({ id: 'a', severity: 'LOW' }),
    event({ id: 'b', severity: 'CRITICAL' }),
    event({ id: 'c', severity: 'MEDIUM' }),
  ]);
  assert.equal(m.east_asia.seismic.severity, 4);
  assert.equal(m.east_asia.seismic.count, 3);
});

test('aggregateHeatmap: events missing location are skipped', () => {
  const m = aggregateHeatmap([event({ location: undefined })]);
  assert.equal(totalEventCount(m), 0);
});

test('aggregateHeatmap: events with unknown domain are skipped', () => {
  const m = aggregateHeatmap([event({ domain: 'mystery' })]);
  assert.equal(totalEventCount(m), 0);
});

test('aggregateHeatmap: events outside any region (e.g. South Pole) are skipped', () => {
  const m = aggregateHeatmap([event({ location: { lat: -89, lon: 0 } })]);
  assert.equal(totalEventCount(m), 0);
});

test('aggregateHeatmap: aliases land in the right column', () => {
  const m = aggregateHeatmap([
    event({ id: 'fire', domain: 'wildfire', location: { lat: 39.74, lon: -104.99 } }),
  ]);
  assert.equal(m.north_america.weather.count, 1);
});

test('aggregateHeatmap: cross-region distribution', () => {
  const m = aggregateHeatmap([
    event({ id: 'a', domain: 'cyber', location: { lat: 52.52, lon: 13.40 }, severity: 'HIGH' }), // Europe
    event({ id: 'b', domain: 'aviation', location: { lat: 28.61, lon: 77.21 }, severity: 'MEDIUM' }), // South Asia
  ]);
  assert.equal(m.europe.cyber.severity, 3);
  assert.equal(m.south_asia.aviation.severity, 2);
  assert.equal(totalEventCount(m), 2);
});

// ── totalEventCount ──────────────────────────────────────────────────────

test('totalEventCount sums every cell', () => {
  const m = aggregateHeatmap([
    event({ id: '1', severity: 'LOW' }),
    event({ id: '2', severity: 'LOW' }),
    event({ id: '3', severity: 'LOW', location: { lat: 52.52, lon: 13.40 } }),
  ]);
  assert.equal(totalEventCount(m), 3);
});

// ── bucketLabel ──────────────────────────────────────────────────────────

test('bucketLabel covers all 5 buckets', () => {
  assert.equal(bucketLabel(0), 'none');
  assert.equal(bucketLabel(1), 'low');
  assert.equal(bucketLabel(2), 'medium');
  assert.equal(bucketLabel(3), 'high');
  assert.equal(bucketLabel(4), 'critical');
});

// ── Matrix dimensions ────────────────────────────────────────────────────

test('aggregateHeatmap output covers every (region, domain) pair', () => {
  const m = aggregateHeatmap([]);
  const regions = Object.keys(m) as RegionKey[];
  assert.equal(regions.length, 9);
  for (const r of regions) {
    const domains = Object.keys(m[r]) as DomainKey[];
    assert.equal(domains.length, 9, `region ${r} should have 9 domains`);
  }
});

test('aggregateHeatmap is deterministic for the same input', () => {
  const events = [event({ id: 'x' }), event({ id: 'y', severity: 'CRITICAL' })];
  assert.deepEqual(aggregateHeatmap(events), aggregateHeatmap(events));
});
