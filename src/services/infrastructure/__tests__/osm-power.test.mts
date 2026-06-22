import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildOverpassQuery,
  parseOverpassPower,
  parseVoltage,
  parsePowerMw,
  summarizePowerContext,
  describeGridReadiness,
  powerAssetsToOverlayRows,
  fetchPowerInfrastructure,
  DEFAULT_OVERPASS_ENDPOINT,
} from '../osm-power.ts';
import type { PowerAsset } from '../osm-power.ts';

const OVERPASS_FIXTURE = {
  elements: [
    {
      type: 'node',
      id: 1,
      lat: 30.1,
      lon: -97.1,
      tags: {
        power: 'plant',
        name: 'Big Plant',
        'plant:output:electricity': '1500 MW',
        'plant:source': 'gas',
        operator: 'Acme Power',
      },
    },
    { type: 'way', id: 2, center: { lat: 30.2, lon: -97.2 }, tags: { power: 'substation', name: 'Sub A', voltage: '345000;138000' } },
    { type: 'way', id: 3, center: { lat: 30.3, lon: -97.3 }, tags: { power: 'line', voltage: '345000' } },
    { type: 'node', id: 4, lat: 30.05, lon: -97.05, tags: { telecom: 'data_center', name: 'DC1' } },
    { type: 'node', id: 5, lat: 30, lon: -97, tags: { amenity: 'cafe' } }, // other → dropped
    { type: 'node', id: 6, tags: { power: 'plant' } }, // no coords → dropped
  ],
};

// ── Query builder ────────────────────────────────────────────────────────────

test('buildOverpassQuery: encodes radius, point, selectors, and out mode', () => {
  const q = buildOverpassQuery(30, -97, 50000, ['plant', 'substation']);
  assert.match(q, /\[out:json\]/);
  assert.match(q, /around:50000,30,-97/);
  assert.match(q, /"power"="plant"/);
  assert.match(q, /"power"="substation"/);
  assert.doesNotMatch(q, /"power"="line"/); // not requested
  assert.match(q, /out center tags;/);
});

// ── Parser ───────────────────────────────────────────────────────────────────

test('parseOverpassPower: classifies, locates ways via center, drops junk', () => {
  const assets = parseOverpassPower(OVERPASS_FIXTURE);
  assert.equal(assets.length, 4); // cafe + coordless plant dropped
  const byId = new Map(assets.map((a) => [a.id, a] as const));

  const plant = byId.get('node/1')!;
  assert.equal(plant.kind, 'plant');
  assert.equal(plant.capacityMw, 1500);
  assert.equal(plant.source, 'gas');
  assert.equal(plant.operator, 'Acme Power');

  const sub = byId.get('way/2')!;
  assert.equal(sub.kind, 'substation');
  assert.equal(sub.lat, 30.2); // from center
  assert.equal(sub.voltageV, 345_000); // max of the ;-list

  assert.equal(byId.get('way/3')!.kind, 'line');
  assert.equal(byId.get('node/4')!.kind, 'data_center');
});

test('parseOverpassPower: tolerates non-object / missing elements', () => {
  assert.deepEqual(parseOverpassPower(null), []);
  assert.deepEqual(parseOverpassPower({}), []);
  assert.deepEqual(parseOverpassPower({ elements: 'nope' }), []);
});

test('parseVoltage: max of a list; junk → undefined', () => {
  assert.equal(parseVoltage('345000;138000'), 345_000);
  assert.equal(parseVoltage('110000'), 110_000);
  assert.equal(parseVoltage(undefined), undefined);
  assert.equal(parseVoltage('n/a'), undefined);
});

test('parsePowerMw: unit conversion to MW', () => {
  assert.equal(parsePowerMw('1500 MW'), 1500);
  assert.equal(parsePowerMw('2.5 GW'), 2500);
  assert.equal(parsePowerMw('750 kW'), 0.75);
  assert.equal(parsePowerMw('100'), 100); // bare number defaults to MW
  assert.equal(parsePowerMw(undefined), undefined);
  assert.equal(parsePowerMw('lots'), undefined);
});

// ── Site summary ─────────────────────────────────────────────────────────────

test('summarizePowerContext: counts, nearest substation/plant, capacity sum', () => {
  const assets = parseOverpassPower(OVERPASS_FIXTURE);
  const ctx = summarizePowerContext({ lat: 30, lon: -97 }, 60, assets);
  assert.equal(ctx.counts.plant, 1);
  assert.equal(ctx.counts.substation, 1);
  assert.equal(ctx.counts.line, 1);
  assert.equal(ctx.counts.data_center, 1);
  assert.equal(ctx.transmissionLineCount, 1);
  assert.equal(ctx.nearbyCapacityMw, 1500);
  assert.ok(ctx.nearestSubstationKm !== undefined && ctx.nearestSubstationKm > 0);
  assert.equal(ctx.nearestPlant?.name, 'Big Plant');
  assert.equal(ctx.nearestPlant?.capacityMw, 1500);
});

test('summarizePowerContext: no substations → nearestSubstationKm undefined', () => {
  const assets: PowerAsset[] = [{ id: 'node/9', kind: 'data_center', lat: 1, lon: 1 }];
  const ctx = summarizePowerContext({ lat: 0, lon: 0 }, 10, assets);
  assert.equal(ctx.nearestSubstationKm, undefined);
  assert.equal(ctx.nearbyCapacityMw, 0);
});

// ── Grid readiness ───────────────────────────────────────────────────────────

test('describeGridReadiness: summarizes substation/generation/lines', () => {
  const assets = parseOverpassPower(OVERPASS_FIXTURE);
  const ctx = summarizePowerContext({ lat: 30, lon: -97 }, 60, assets);
  const r = describeGridReadiness(ctx);
  assert.equal(r.weakGridTie, false);
  assert.match(r.summary, /nearest substation/);
  assert.match(r.summary, /1500 MW generation within 60 km/);
  assert.match(r.summary, /1 transmission line\b/);
});

test('describeGridReadiness: flags a weak grid tie when no substation in range', () => {
  const ctx = summarizePowerContext({ lat: 0, lon: 0 }, 10, [
    { id: 'node/1', kind: 'plant', lat: 0.01, lon: 0.01, capacityMw: 200 },
  ]);
  const r = describeGridReadiness(ctx);
  assert.equal(r.weakGridTie, true);
  assert.match(r.summary, /no substation mapped in range/);
});

// ── Overlay rows ─────────────────────────────────────────────────────────────

test('powerAssetsToOverlayRows: capacity boosts plant weight; fallback labels', () => {
  const rows = powerAssetsToOverlayRows(parseOverpassPower(OVERPASS_FIXTURE));
  const plant = rows.find((r) => r.id === 'node/1')!;
  const line = rows.find((r) => r.id === 'way/3')!;
  assert.ok(plant.weight > 0.6, `plant weight ${plant.weight} should exceed base 0.6`);
  assert.equal(line.label, 'Transmission line'); // no name → fallback
});

// ── Fetch (injected) ─────────────────────────────────────────────────────────

test('fetchPowerInfrastructure: parses an injected OK response', async () => {
  const calls: { url: string; body: string }[] = [];
  const fakeFetch = (async (url: string, init: { body: string }) => {
    calls.push({ url, body: init.body });
    return { ok: true, json: async () => OVERPASS_FIXTURE };
  }) as unknown as typeof fetch;

  const assets = await fetchPowerInfrastructure(30, -97, 50, { fetchImpl: fakeFetch });
  assert.equal(assets.length, 4);
  assert.equal(calls[0]!.url, DEFAULT_OVERPASS_ENDPOINT);
  assert.match(calls[0]!.body, /^data=/);
  assert.match(decodeURIComponent(calls[0]!.body), /around:50000/); // 50 km → 50000 m
});

test('fetchPowerInfrastructure: returns [] on non-ok and on throw', async () => {
  const notOk = (async () => ({ ok: false, json: async () => ({}) })) as unknown as typeof fetch;
  const throws = (async () => { throw new Error('network'); }) as unknown as typeof fetch;
  assert.deepEqual(await fetchPowerInfrastructure(0, 0, 10, { fetchImpl: notOk }), []);
  assert.deepEqual(await fetchPowerInfrastructure(0, 0, 10, { fetchImpl: throws }), []);
});
