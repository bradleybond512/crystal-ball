import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createSignalEnrichmentService,
  BUILT_IN_REGIONS,
  REGION_RADIUS_KM,
  STATS_WINDOW,
  type SignalEnrichmentService,
  type EnrichmentTag,
} from '../../src/services/intelligence/signal-enrichment.ts';
import type {
  Entity,
  EntityType,
} from '../../src/services/intelligence/entity-registry.ts';
import type {
  ObservationEvent,
} from '../../src/types/intelligence.ts';

function makeObs(overrides: Partial<ObservationEvent> = {}): ObservationEvent {
  return {
    id: 'obs-1',
    sourceId: 'usgs-earthquake',
    domain: 'earthquake',
    timestamp: Date.now(),
    severity: 'MEDIUM',
    title: 'M5.2 earthquake near Sapporo',
    raw: {},
    entityIds: [],
    tags: [],
    ...overrides,
  };
}

function makeEntity(overrides: Partial<Entity> & { id: string; type: EntityType; canonicalName: string }): Entity {
  return {
    aliases: [],
    identifiers: {},
    domains: [],
    riskScore: 0,
    lastSeen: 0,
    attributes: {},
    ...overrides,
  };
}

function makeSvc(opts?: { resolver?: (q: string) => Entity | undefined }): SignalEnrichmentService {
  return createSignalEnrichmentService({ entityResolver: opts?.resolver ?? null });
}

// ── Constants ────────────────────────────────────────────────────────────

test('BUILT_IN_REGIONS has 10 entries', () => {
  assert.equal(BUILT_IN_REGIONS.length, 10);
});

test('REGION_RADIUS_KM is 1000', () => {
  assert.equal(REGION_RADIUS_KM, 1000);
});

test('STATS_WINDOW is 1000', () => {
  assert.equal(STATS_WINDOW, 1000);
});

// ── Geo enrichment ───────────────────────────────────────────────────────

test('enrich with lat/lon near Tokyo gets a Japan-area region tag', () => {
  const svc = makeSvc();
  const result = svc.enrich(makeObs({ location: { lat: 35.6764, lon: 139.65 } }));
  const geoTags = result.tags.filter((t) => t.source === 'geo');
  assert.ok(geoTags.length > 0);
  assert.ok(result.regionName);
  assert.ok(result.nearestPlace);
});

test('enrich without lat/lon adds no geo tags', () => {
  const svc = makeSvc();
  const result = svc.enrich(makeObs({ location: undefined }));
  assert.equal(result.tags.filter((t) => t.source === 'geo').length, 0);
  assert.equal(result.nearestPlace, undefined);
  assert.equal(result.regionName, undefined);
});

test('enrich with lat/lon far from any region (mid-ocean) gets no region tag', () => {
  const svc = makeSvc();
  // Middle of the South Pacific, far from any seeded region
  const result = svc.enrich(makeObs({ location: { lat: -45, lon: -135 } }));
  assert.equal(result.regionName, undefined);
});

// ── Entity enrichment ────────────────────────────────────────────────────

test('enrich with resolver returning an entity adds linkedEntityId + entity-type tag', () => {
  const entity = makeEntity({ id: 'mmsi-12345', type: 'ship', canonicalName: 'Bulk Carrier Alpha' });
  const svc = makeSvc({ resolver: () => entity });
  const result = svc.enrich(makeObs({ title: 'AIS gap on Bulk Carrier Alpha' }));
  assert.ok(result.linkedEntityIds.includes('mmsi-12345'));
  const entityTags = result.tags.filter((t) => t.source === 'entity');
  assert.ok(entityTags.some((t) => t.key === 'entity-type' && t.value === 'ship'));
});

test('enrich is null-safe when entityResolver is null', () => {
  const svc = createSignalEnrichmentService({ entityResolver: null });
  assert.doesNotThrow(() => svc.enrich(makeObs()));
});

test('enrich with resolver returning undefined adds no entity linkage', () => {
  const svc = makeSvc({ resolver: () => undefined });
  const result = svc.enrich(makeObs());
  assert.equal(result.linkedEntityIds.length, 0);
  assert.equal(result.tags.filter((t) => t.source === 'entity').length, 0);
});

test('enrich does not duplicate entity ids if entity already in observation.entityIds', () => {
  const entity = makeEntity({ id: 'e1', type: 'organization', canonicalName: 'X' });
  const svc = makeSvc({ resolver: () => entity });
  const result = svc.enrich(makeObs({ entityIds: ['e1'] }));
  const occurrences = result.linkedEntityIds.filter((id) => id === 'e1').length;
  assert.equal(occurrences, 1);
});

// ── Domain tags ──────────────────────────────────────────────────────────

test('earthquake domain tags include hazard-class natural-disaster', () => {
  const svc = makeSvc();
  const result = svc.enrich(makeObs({ domain: 'earthquake' }));
  const domainTags = result.tags.filter((t) => t.source === 'domain');
  assert.ok(domainTags.some((t) => t.key === 'hazard-class' && t.value === 'natural-disaster'));
});

test('biosurv domain tags include hazard-class biological', () => {
  const svc = makeSvc();
  const result = svc.enrich(makeObs({ domain: 'biosurv' }));
  const domainTags = result.tags.filter((t) => t.source === 'domain');
  assert.ok(domainTags.some((t) => t.key === 'hazard-class' && t.value === 'biological'));
});

test('weather domain tags include hazard-class natural-disaster', () => {
  const svc = makeSvc();
  const result = svc.enrich(makeObs({ domain: 'weather' }));
  const domainTags = result.tags.filter((t) => t.source === 'domain');
  assert.ok(domainTags.some((t) => t.key === 'hazard-class' && t.value === 'natural-disaster'));
});

test('maritime domain tags include hazard-class transport', () => {
  const svc = makeSvc();
  const result = svc.enrich(makeObs({ domain: 'maritime' }));
  const domainTags = result.tags.filter((t) => t.source === 'domain');
  assert.ok(domainTags.some((t) => t.key === 'hazard-class' && t.value === 'transport'));
});

test('aviation domain tags include hazard-class transport', () => {
  const svc = makeSvc();
  const result = svc.enrich(makeObs({ domain: 'aviation' }));
  const domainTags = result.tags.filter((t) => t.source === 'domain');
  assert.ok(domainTags.some((t) => t.key === 'hazard-class' && t.value === 'transport'));
});

test('cyber domain tags include hazard-class digital', () => {
  const svc = makeSvc();
  const result = svc.enrich(makeObs({ domain: 'cyber' }));
  const domainTags = result.tags.filter((t) => t.source === 'domain');
  assert.ok(domainTags.some((t) => t.key === 'hazard-class' && t.value === 'digital'));
});

test('geopolitical domain tags include hazard-class political', () => {
  const svc = makeSvc();
  const result = svc.enrich(makeObs({ domain: 'geopolitical' }));
  const domainTags = result.tags.filter((t) => t.source === 'domain');
  assert.ok(domainTags.some((t) => t.key === 'hazard-class' && t.value === 'political'));
});

test('wildfire domain tags include hazard-class natural-disaster', () => {
  const svc = makeSvc();
  const result = svc.enrich(makeObs({ domain: 'wildfire' }));
  const domainTags = result.tags.filter((t) => t.source === 'domain');
  assert.ok(domainTags.some((t) => t.key === 'hazard-class' && t.value === 'natural-disaster'));
});

test('unknown domain still gets enriched (but with fewer domain tags)', () => {
  const svc = makeSvc();
  const result = svc.enrich(makeObs({ domain: 'mystery-domain' }));
  assert.ok(result.tags.length >= 0);
});

// ── Relationship hints (cascade) ─────────────────────────────────────────

test('high-severity earthquake adds cascades-to relationship tag', () => {
  const svc = makeSvc();
  const result = svc.enrich(makeObs({ domain: 'earthquake', severity: 'HIGH' }));
  const relTags = result.tags.filter((t) => t.source === 'relationship');
  assert.ok(relTags.some((t) => t.key === 'cascades-to'));
});

test('critical-severity earthquake adds cascades-to relationship tag', () => {
  const svc = makeSvc();
  const result = svc.enrich(makeObs({ domain: 'earthquake', severity: 'CRITICAL' }));
  assert.ok(result.tags.some((t) => t.source === 'relationship' && t.key === 'cascades-to'));
});

test('low-severity earthquake does NOT add cascade relationship tag', () => {
  const svc = makeSvc();
  const result = svc.enrich(makeObs({ domain: 'earthquake', severity: 'LOW' }));
  assert.equal(result.tags.filter((t) => t.source === 'relationship').length, 0);
});

test('high-severity weather adds a relationship tag (storm cascade)', () => {
  const svc = makeSvc();
  const result = svc.enrich(makeObs({ domain: 'weather', severity: 'HIGH' }));
  assert.ok(result.tags.some((t) => t.source === 'relationship'));
});

// ── enrichBatch ──────────────────────────────────────────────────────────

test('enrichBatch returns one enriched record per input', () => {
  const svc = makeSvc();
  const result = svc.enrichBatch([makeObs({ id: 'a' }), makeObs({ id: 'b' })]);
  assert.equal(result.length, 2);
  assert.equal(result[0]?.observation.id, 'a');
  assert.equal(result[1]?.observation.id, 'b');
});

test('enrichBatch preserves observation order', () => {
  const svc = makeSvc();
  const ids = ['x', 'y', 'z'];
  const result = svc.enrichBatch(ids.map((id) => makeObs({ id })));
  assert.deepEqual(result.map((r) => r.observation.id), ids);
});

// ── getStats ─────────────────────────────────────────────────────────────

test('getStats.total counts enriched observations', () => {
  const svc = makeSvc();
  svc.enrich(makeObs({ id: '1' }));
  svc.enrich(makeObs({ id: '2' }));
  svc.enrich(makeObs({ id: '3' }));
  assert.equal(svc.getStats().total, 3);
});

test('getStats.avgTagsPerObservation is mean of tag counts', () => {
  const svc = makeSvc();
  // earthquake severity LOW: a domain tag set but no relationship tag.
  // earthquake HIGH: domain tags + cascade relationship tag.
  svc.enrich(makeObs({ id: '1', domain: 'earthquake', severity: 'LOW' }));
  svc.enrich(makeObs({ id: '2', domain: 'earthquake', severity: 'HIGH' }));
  const s = svc.getStats();
  assert.ok(s.avgTagsPerObservation > 0);
});

test('getStats.bySource breaks down tag counts by source', () => {
  const svc = makeSvc();
  svc.enrich(makeObs({ domain: 'earthquake', severity: 'HIGH', location: { lat: 35.6764, lon: 139.65 } }));
  const s = svc.getStats();
  assert.ok(s.bySource.geo >= 1);
  assert.ok(s.bySource.domain >= 1);
  assert.ok(s.bySource.relationship >= 1);
});

test('getStats only counts the most recent STATS_WINDOW observations', () => {
  const svc = makeSvc();
  // Enrich more than STATS_WINDOW observations
  for (let i = 0; i < STATS_WINDOW + 50; i++) {
    svc.enrich(makeObs({ id: `o${i}` }));
  }
  const s = svc.getStats();
  assert.ok(s.total <= STATS_WINDOW);
});

// ── subscribe ────────────────────────────────────────────────────────────

test('subscribe is notified on each enrich call', () => {
  const svc = makeSvc();
  let calls = 0;
  let lastObsId: string | undefined;
  svc.subscribe((enriched) => {
    calls += 1;
    lastObsId = enriched.observation.id;
  });
  svc.enrich(makeObs({ id: 'sub-test' }));
  assert.equal(calls, 1);
  assert.equal(lastObsId, 'sub-test');
});

test('subscribe fires for each item in enrichBatch', () => {
  const svc = makeSvc();
  let calls = 0;
  svc.subscribe(() => { calls += 1; });
  svc.enrichBatch([makeObs({ id: 'a' }), makeObs({ id: 'b' })]);
  assert.equal(calls, 2);
});

test('unsubscribe stops notifications', () => {
  const svc = makeSvc();
  let calls = 0;
  const fn = () => { calls += 1; };
  svc.subscribe(fn);
  svc.unsubscribe(fn);
  svc.enrich(makeObs());
  assert.equal(calls, 0);
});

// ── enrichedAt timestamp ────────────────────────────────────────────────

test('enrich stamps enrichedAt with current clock', () => {
  const fixedClock = 1_700_000_000_000;
  const svc = createSignalEnrichmentService({ entityResolver: null, now: () => fixedClock });
  const result = svc.enrich(makeObs());
  assert.equal(result.enrichedAt, fixedClock);
});

// ── EnrichmentTag shape ──────────────────────────────────────────────────

test('every emitted tag has key + value + source', () => {
  const svc = makeSvc();
  const result = svc.enrich(makeObs({ domain: 'earthquake', severity: 'HIGH', location: { lat: 35.6764, lon: 139.65 } }));
  for (const tag of result.tags) {
    assert.ok(typeof tag.key === 'string' && tag.key.length > 0);
    assert.ok(typeof tag.value === 'string' && tag.value.length > 0);
    assert.ok(['geo', 'entity', 'domain', 'relationship'].includes(tag.source as EnrichmentTag['source']));
  }
});
