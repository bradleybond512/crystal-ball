/**
 * Tests for GeopoliticalSuperpowerPanel helpers — pure aggregator + rendering.
 *
 * The Panel class itself extends a base that transitively pulls Vite-only
 * `?worker` imports, so this suite targets the testable boundary: the pure
 * functions exported from `geopolitical-superpower-helpers.ts`.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { Situation } from '../../src/services/intelligence/situation-store-v2.ts';
import type { Entity } from '../../src/services/intelligence/entity-registry.ts';
import type { CalendarEvent } from '../../src/services/intelligence/geopolitical-event-calendar.ts';

const NOW = 1_745_000_000_000;
const ONE_HOUR = 60 * 60 * 1000;
const ONE_DAY = 24 * ONE_HOUR;

function makeSituation(overrides: Partial<Situation> = {}): Situation {
  return {
    id: overrides.id ?? 'sit-1',
    name: overrides.name ?? 'Test situation',
    domain: overrides.domain ?? 'geopolitical',
    relatedDomains: overrides.relatedDomains ?? [],
    severity: overrides.severity ?? 'medium',
    status: overrides.status ?? 'active',
    summary: overrides.summary ?? '',
    observations: overrides.observations ?? [],
    edges: overrides.edges ?? [],
    entityIds: overrides.entityIds ?? [],
    confidence: overrides.confidence ?? 0.7,
    startedAt: overrides.startedAt ?? new Date(NOW - ONE_HOUR),
    updatedAt: overrides.updatedAt ?? new Date(NOW),
    resolvedAt: overrides.resolvedAt,
    location: overrides.location,
    tags: overrides.tags ?? [],
  };
}

function makeEntity(overrides: Partial<Entity> = {}): Entity {
  return {
    id: overrides.id ?? 'ent-1',
    type: overrides.type ?? 'organization',
    canonicalName: overrides.canonicalName ?? 'Test Org',
    aliases: overrides.aliases ?? [],
    identifiers: overrides.identifiers ?? {},
    domains: overrides.domains ?? [],
    riskScore: overrides.riskScore ?? 0.5,
    lastSeen: overrides.lastSeen ?? NOW,
    attributes: overrides.attributes ?? {},
  };
}

function makeEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: overrides.id ?? 'evt-1',
    type: overrides.type ?? 'summit',
    title: overrides.title ?? 'Test summit',
    description: overrides.description ?? '',
    country: overrides.country ?? 'XX',
    region: overrides.region ?? 'Europe',
    scheduledAt: overrides.scheduledAt ?? (NOW + 7 * ONE_DAY),
    domains: overrides.domains ?? ['geopolitical'],
    riskLevel: overrides.riskLevel ?? 'medium',
    riskRationale: overrides.riskRationale ?? '',
    tags: overrides.tags ?? [],
    source: overrides.source ?? 'test',
    createdAt: overrides.createdAt ?? NOW,
    acknowledged: overrides.acknowledged ?? false,
  };
}

const {
  regionOf,
  computeConflictHeat,
  computeSanctionsView,
  computeEventStream,
  computeAllianceMonitor,
  computeFlashpoints,
  buildViewModel,
  renderHtml,
} = await import('../../src/components/geopolitical-superpower-helpers.ts');

// ── regionOf ──────────────────────────────────────────────────────────────

describe('regionOf', () => {
  it('uses an explicit region:* tag when present', () => {
    assert.equal(regionOf(makeSituation({ tags: ['region:europe'] })), 'europe');
  });

  it('buckets by longitude when no tag', () => {
    assert.equal(regionOf(makeSituation({ location: { lat: 40, lon: -80, radiusKm: 50 } })), 'americas');
    assert.equal(regionOf(makeSituation({ location: { lat: 48, lon: 2, radiusKm: 50 } })), 'europe');
    assert.equal(regionOf(makeSituation({ location: { lat: 0, lon: 50, radiusKm: 50 } })), 'africa');
    assert.equal(regionOf(makeSituation({ location: { lat: 35, lon: 139, radiusKm: 50 } })), 'asia');
  });

  it('returns "unknown" when no tag or location', () => {
    assert.equal(regionOf(makeSituation()), 'unknown');
  });

  it('lowercases the region tag value', () => {
    assert.equal(regionOf(makeSituation({ tags: ['region:EUROPE'] })), 'europe');
  });
});

// ── computeConflictHeat ───────────────────────────────────────────────────

describe('computeConflictHeat', () => {
  it('returns empty when no conflict situations', () => {
    assert.deepEqual(computeConflictHeat([], new Map()), []);
  });

  it('skips resolved situations', () => {
    const s = makeSituation({ domain: 'conflict', status: 'resolved', tags: ['region:europe'] });
    assert.deepEqual(computeConflictHeat([s], new Map()), []);
  });

  it('skips non-conflict domains', () => {
    const s = makeSituation({ domain: 'weather', tags: ['region:europe'] });
    assert.deepEqual(computeConflictHeat([s], new Map()), []);
  });

  it('sums severity weights per region', () => {
    const rows = computeConflictHeat([
      makeSituation({ id: 'a', domain: 'conflict', severity: 'critical', tags: ['region:europe'] }),
      makeSituation({ id: 'b', domain: 'conflict', severity: 'high', tags: ['region:europe'] }),
      makeSituation({ id: 'c', domain: 'conflict', severity: 'low', tags: ['region:asia'] }),
    ], new Map());
    const europe = rows.find(r => r.region === 'europe');
    assert.equal(europe?.score, 80);
    assert.equal(europe?.activeCount, 2);
    assert.equal(europe?.criticalCount, 1);
  });

  it('clips score to 100', () => {
    const sits = Array.from({ length: 5 }, (_, i) =>
      makeSituation({ id: `s${i}`, domain: 'conflict', severity: 'critical', tags: ['region:europe'] }),
    );
    const rows = computeConflictHeat(sits, new Map());
    assert.equal(rows[0]!.score, 100);
  });

  it('applies sanctions boost', () => {
    const rows = computeConflictHeat([], new Map([['europe', 10]]));
    assert.ok(rows.length > 0);
    assert.equal(rows[0]!.region, 'europe');
    assert.equal(rows[0]!.score, 20);
  });

  it('sorts highest-score first', () => {
    const rows = computeConflictHeat([
      makeSituation({ id: 'a', domain: 'conflict', severity: 'low', tags: ['region:asia'] }),
      makeSituation({ id: 'b', domain: 'conflict', severity: 'critical', tags: ['region:europe'] }),
    ], new Map());
    assert.equal(rows[0]!.region, 'europe');
  });
});

// ── computeSanctionsView ──────────────────────────────────────────────────

describe('computeSanctionsView', () => {
  it('counts entities with ofac-sdn identifier', () => {
    const view = computeSanctionsView([
      makeEntity({ id: 'a', identifiers: { 'ofac-sdn': '12345' } }),
      makeEntity({ id: 'b' }),
    ], NOW);
    assert.equal(view.totalDesignated, 1);
  });

  it('also counts entities in sanctions domain', () => {
    const view = computeSanctionsView([
      makeEntity({ id: 'a', domains: ['sanctions'] }),
    ], NOW);
    assert.equal(view.totalDesignated, 1);
  });

  it('returns top countries sorted by count desc', () => {
    const view = computeSanctionsView([
      makeEntity({ id: 'a', identifiers: { 'ofac-sdn': '1', iso3: 'RUS' } }),
      makeEntity({ id: 'b', identifiers: { 'ofac-sdn': '2', iso3: 'RUS' } }),
      makeEntity({ id: 'c', identifiers: { 'ofac-sdn': '3', iso3: 'IRN' } }),
    ], NOW);
    assert.equal(view.topCountries[0]?.iso, 'RUS');
    assert.equal(view.topCountries[0]?.count, 2);
  });

  it('caps topCountries at 5', () => {
    const ents = Array.from({ length: 10 }, (_, i) =>
      makeEntity({ id: `e${i}`, identifiers: { 'ofac-sdn': `${i}`, iso3: `C${i}` } }),
    );
    assert.equal(computeSanctionsView(ents, NOW).topCountries.length, 5);
  });

  it('lists recent designations within the 14-day window', () => {
    const view = computeSanctionsView([
      makeEntity({ id: 'recent', identifiers: { 'ofac-sdn': '1' }, lastSeen: NOW - ONE_DAY }),
      makeEntity({ id: 'old',    identifiers: { 'ofac-sdn': '2' }, lastSeen: NOW - 30 * ONE_DAY }),
    ], NOW);
    assert.equal(view.recentDesignations.length, 1);
    assert.equal(view.recentDesignations[0]?.id, 'recent');
  });

  it('returns sanctionsByRegion map keyed off attribute', () => {
    const view = computeSanctionsView([
      makeEntity({ id: 'a', identifiers: { 'ofac-sdn': '1' }, attributes: { region: 'Europe' } }),
      makeEntity({ id: 'b', identifiers: { 'ofac-sdn': '2' }, attributes: { region: 'Europe' } }),
    ], NOW);
    assert.equal(view.sanctionsByRegion.get('europe'), 2);
  });

  it('handles entities with no country gracefully', () => {
    const view = computeSanctionsView([
      makeEntity({ id: 'a', identifiers: { 'ofac-sdn': '1' } }),
    ], NOW);
    assert.equal(view.totalDesignated, 1);
    assert.equal(view.topCountries.length, 0);
  });
});

// ── computeEventStream ────────────────────────────────────────────────────

describe('computeEventStream', () => {
  it('filters to geopolitical-adjacent domains', () => {
    const out = computeEventStream([
      makeSituation({ id: 'a', domain: 'geopolitical' }),
      makeSituation({ id: 'b', domain: 'weather' }),
    ]);
    assert.equal(out.length, 1);
    assert.equal(out[0]?.id, 'a');
  });

  it('sorts latest first', () => {
    const out = computeEventStream([
      makeSituation({ id: 'old', domain: 'geopolitical', updatedAt: new Date(NOW - ONE_HOUR) }),
      makeSituation({ id: 'new', domain: 'geopolitical', updatedAt: new Date(NOW) }),
    ]);
    assert.equal(out[0]?.id, 'new');
  });

  it('respects the limit', () => {
    const sits = Array.from({ length: 20 }, (_, i) =>
      makeSituation({ id: `s${i}`, domain: 'geopolitical' }),
    );
    assert.equal(computeEventStream(sits, 5).length, 5);
  });
});

// ── computeAllianceMonitor ────────────────────────────────────────────────

describe('computeAllianceMonitor', () => {
  it('includes summit + treaty-deadline calendar events', () => {
    const out = computeAllianceMonitor([], [
      makeEvent({ id: 'summit', type: 'summit' }),
      makeEvent({ id: 'treaty', type: 'treaty-deadline' }),
      makeEvent({ id: 'other', type: 'election' }),
    ]);
    assert.equal(out.length, 2);
    assert.ok(out.some(s => s.id === 'summit'));
    assert.ok(out.some(s => s.id === 'treaty'));
  });

  it('includes alliance-tagged situations', () => {
    const out = computeAllianceMonitor([
      makeSituation({ id: 'al', tags: ['treaty'] }),
    ], []);
    assert.equal(out.length, 1);
    assert.equal(out[0]?.kind, 'situation');
  });

  it('excludes resolved alliance situations', () => {
    const out = computeAllianceMonitor([
      makeSituation({ id: 'r', tags: ['treaty'], status: 'resolved' }),
    ], []);
    assert.equal(out.length, 0);
  });

  it('sorts by whenMs ascending', () => {
    const out = computeAllianceMonitor([], [
      makeEvent({ id: 'late', type: 'summit', scheduledAt: NOW + 30 * ONE_DAY }),
      makeEvent({ id: 'soon', type: 'summit', scheduledAt: NOW + ONE_DAY }),
    ]);
    assert.equal(out[0]?.id, 'soon');
  });
});

// ── computeFlashpoints ────────────────────────────────────────────────────

describe('computeFlashpoints', () => {
  it('returns empty when nothing high or critical', () => {
    assert.deepEqual(computeFlashpoints([
      makeSituation({ severity: 'low', location: { lat: 0, lon: 0, radiusKm: 50 } }),
    ], NOW), []);
  });

  it('requires a location', () => {
    assert.deepEqual(computeFlashpoints([
      makeSituation({ severity: 'critical' }),
    ], NOW), []);
  });

  it('orders critical before high when both are recent', () => {
    const out = computeFlashpoints([
      makeSituation({ id: 'h', severity: 'high',     location: { lat: 0, lon: 0, radiusKm: 50 } }),
      makeSituation({ id: 'c', severity: 'critical', location: { lat: 0, lon: 0, radiusKm: 50 } }),
    ], NOW);
    assert.equal(out[0]?.id, 'c');
  });

  it('caps at 8 entries', () => {
    const sits = Array.from({ length: 12 }, (_, i) =>
      makeSituation({ id: `s${i}`, severity: 'high', location: { lat: i, lon: i, radiusKm: 50 } }),
    );
    assert.equal(computeFlashpoints(sits, NOW).length, 8);
  });

  it('decays older situations behind fresh ones of the same severity', () => {
    const fresh = makeSituation({ id: 'fresh', severity: 'critical', location: { lat: 0, lon: 0, radiusKm: 50 }, updatedAt: new Date(NOW) });
    const stale = makeSituation({ id: 'stale', severity: 'critical', location: { lat: 1, lon: 1, radiusKm: 50 }, updatedAt: new Date(NOW - 5 * ONE_DAY) });
    const out = computeFlashpoints([stale, fresh], NOW);
    assert.equal(out[0]?.id, 'fresh');
  });
});

// ── buildViewModel ────────────────────────────────────────────────────────

describe('buildViewModel', () => {
  it('produces a full snapshot with no errors when deps succeed', () => {
    const vm = buildViewModel({
      getSituations: () => [makeSituation({ domain: 'conflict', severity: 'critical', tags: ['region:europe'] })],
      getEntities: () => [makeEntity({ identifiers: { 'ofac-sdn': '1' }, attributes: { region: 'Europe' } })],
      getCalendarEvents: () => [makeEvent({ type: 'summit' })],
      now: () => NOW,
    });
    assert.equal(vm.errors.length, 0);
    assert.ok(vm.conflictHeat.length > 0);
    assert.equal(vm.sanctions.totalDesignated, 1);
    assert.equal(vm.alliance.length, 1);
  });

  it('falls back to empty arrays when getSituations throws', () => {
    const vm = buildViewModel({
      getSituations: () => { throw new Error('boom'); },
      getEntities: () => [],
      getCalendarEvents: () => [],
      now: () => NOW,
    });
    assert.deepEqual(vm.conflictHeat, []);
    assert.deepEqual(vm.eventStream, []);
  });

  it('falls back to empty arrays when getEntities throws', () => {
    const vm = buildViewModel({
      getSituations: () => [],
      getEntities: () => { throw new Error('boom'); },
      getCalendarEvents: () => [],
      now: () => NOW,
    });
    assert.equal(vm.sanctions.totalDesignated, 0);
  });

  it('falls back to empty arrays when getCalendarEvents throws', () => {
    const vm = buildViewModel({
      getSituations: () => [],
      getEntities: () => [],
      getCalendarEvents: () => { throw new Error('boom'); },
      now: () => NOW,
    });
    assert.deepEqual(vm.alliance, []);
  });

  it('handles every dep throwing without crashing', () => {
    const vm = buildViewModel({
      getSituations: () => { throw new Error('x'); },
      getEntities: () => { throw new Error('x'); },
      getCalendarEvents: () => { throw new Error('x'); },
      now: () => NOW,
    });
    assert.ok(vm);
    assert.deepEqual(vm.conflictHeat, []);
  });
});

// ── renderHtml ────────────────────────────────────────────────────────────

describe('renderHtml', () => {
  function emptyVm() {
    return buildViewModel({
      getSituations: () => [],
      getEntities: () => [],
      getCalendarEvents: () => [],
      now: () => NOW,
    });
  }

  it('renders all five section titles', () => {
    const html = renderHtml(emptyVm(), NOW);
    assert.ok(html.includes('Conflict Heat Index'));
    assert.ok(html.includes('Sanctions Radar'));
    assert.ok(html.includes('GDELT Event Stream'));
    assert.ok(html.includes('Alliance Stability Monitor'));
    assert.ok(html.includes('Flashpoint Watch'));
  });

  it('renders empty-state copy for each section when data is missing', () => {
    const html = renderHtml(emptyVm(), NOW);
    assert.ok(html.includes('No active conflict signal'));
    assert.ok(html.includes('No designated entities tracked'));
    assert.ok(html.includes('No recent geopolitical events'));
    assert.ok(html.includes('No alliance signals pending'));
    assert.ok(html.includes('No flashpoints'));
  });

  it('escapes HTML in titles', () => {
    const vm = buildViewModel({
      getSituations: () => [makeSituation({ id: 's', name: '<script>alert(1)</script>', domain: 'geopolitical' })],
      getEntities: () => [],
      getCalendarEvents: () => [],
      now: () => NOW,
    });
    const html = renderHtml(vm, NOW);
    assert.ok(!html.includes('<script>alert(1)</script>'));
    assert.ok(html.includes('&lt;script&gt;'));
  });
});

// ── Additional rendering / error coverage ────────────────────────────────

describe('renderHtml — populated', () => {
  it('renders an error row when buildViewModel reports errors', () => {
    const vm = buildViewModel({
      getSituations: () => { throw new Error('boom'); },
      getEntities: () => [],
      getCalendarEvents: () => [],
      now: () => NOW,
    });
    const html = renderHtml(vm, NOW);
    assert.ok(html.includes('Situations unavailable'));
    assert.ok(html.includes('geo-error-row'));
  });

  it('renders a heat row with score and meta for a populated region', () => {
    const vm = buildViewModel({
      getSituations: () => [makeSituation({ domain: 'conflict', severity: 'critical', tags: ['region:europe'] })],
      getEntities: () => [],
      getCalendarEvents: () => [],
      now: () => NOW,
    });
    const html = renderHtml(vm, NOW);
    assert.ok(html.includes('Europe'));
    assert.ok(html.includes('geo-heat-fill'));
    assert.ok(html.includes('1 active'));
  });

  it('renders sanctions count when designations exist', () => {
    const vm = buildViewModel({
      getSituations: () => [],
      getEntities: () => [makeEntity({ identifiers: { 'ofac-sdn': '1', iso3: 'RUS' } })],
      getCalendarEvents: () => [],
      now: () => NOW,
    });
    const html = renderHtml(vm, NOW);
    assert.ok(html.includes('designated entities'));
    assert.ok(html.includes('RUS'));
  });

  it('renders flashpoint coordinates', () => {
    const vm = buildViewModel({
      getSituations: () => [makeSituation({ severity: 'critical', location: { lat: 50.5, lon: 10.25, radiusKm: 50 } })],
      getEntities: () => [],
      getCalendarEvents: () => [],
      now: () => NOW,
    });
    const html = renderHtml(vm, NOW);
    assert.ok(html.includes('50.50, 10.25'));
  });

  it('errors row absent when all deps succeed', () => {
    const vm = buildViewModel({
      getSituations: () => [],
      getEntities: () => [],
      getCalendarEvents: () => [],
      now: () => NOW,
    });
    assert.ok(!renderHtml(vm, NOW).includes('geo-error-row'));
  });
});
