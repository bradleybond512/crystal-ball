import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeHealthContributor } from '../health-contributor.ts';
import type { DiseaseIntelData, WhoDonAlert, EpidemicEvent } from '../../disease-intel.ts';

const NOW = 1_700_000_000_000;

function whoDon(over: Partial<WhoDonAlert> = {}): WhoDonAlert {
  return {
    id: 'don-1',
    title: 'Marburg virus disease – Rwanda',
    disease: 'Marburg virus disease',
    country: 'Rwanda',
    date: new Date(NOW),
    url: 'https://who.int/x',
    ...over,
  };
}

function epidemic(over: Partial<EpidemicEvent> = {}): EpidemicEvent {
  return {
    id: 'ep-1',
    name: 'Cholera outbreak',
    country: 'Sudan',
    iso3: 'SDN',
    status: 'ongoing',
    date: new Date(NOW),
    url: 'https://reliefweb.int/x',
    ...over,
  };
}

function data(over: Partial<DiseaseIntelData> = {}): DiseaseIntelData {
  return {
    variants: [],
    covidCountries: [],
    epidemicEvents: [],
    whoDon: [],
    crossReferencedWithPromed: [],
    fetchedAt: new Date(NOW),
    ...over,
  };
}

test('null data produces no threats', () => {
  assert.deepEqual(makeHealthContributor(null).contribute(NOW), []);
});

test('empty disease data produces no threats', () => {
  assert.deepEqual(makeHealthContributor(data()).contribute(NOW), []);
});

test('a WHO DON alert -> one advisory health threat (severity 50)', () => {
  const t = makeHealthContributor(data({ whoDon: [whoDon()] })).contribute(NOW);
  assert.equal(t.length, 1);
  assert.equal(t[0]!.axis, 'health');
  assert.equal(t[0]!.threatLevel, 'advisory');
  assert.equal(t[0]!.severity, 50);
  assert.equal(t[0]!.confidenceLabel, 'high');
  assert.equal(t[0]!.sourceEventId, 'whodon-don-1');
});

test('WHO DON alert why/label carry disease and country', () => {
  const t = makeHealthContributor(data({ whoDon: [whoDon()] })).contribute(NOW)[0]!;
  assert.match(t.hazardLabel, /WHO outbreak alert: Marburg virus disease/);
  assert.match(t.why, /in Rwanda/);
});

test('epidemic status alert -> advisory (severity 50)', () => {
  const t = makeHealthContributor(data({ epidemicEvents: [epidemic({ status: 'alert' })] })).contribute(NOW);
  assert.equal(t[0]!.threatLevel, 'advisory');
  assert.equal(t[0]!.severity, 50);
  assert.equal(t[0]!.sourceEventId, 'epidemic-ep-1');
});

test('epidemic status ongoing -> watch (severity 30)', () => {
  const t = makeHealthContributor(data({ epidemicEvents: [epidemic({ status: 'ongoing' })] })).contribute(NOW);
  assert.equal(t[0]!.threatLevel, 'watch');
  assert.equal(t[0]!.severity, 30);
});

test('epidemic status past -> dropped (no threat)', () => {
  const t = makeHealthContributor(data({ epidemicEvents: [epidemic({ status: 'past' })] })).contribute(NOW);
  assert.deepEqual(t, []);
});

test('endemic covid counts are intentionally not mapped', () => {
  const t = makeHealthContributor(data({
    covidCountries: [{
      country: 'X', iso2: 'X', lat: 0, lon: 0,
      active: 9_000_000, todayCases: 500_000, casesPerOneMillion: 400_000, updatedMs: NOW,
    }],
  })).contribute(NOW);
  assert.deepEqual(t, []);
});

test('WHO DON confidence high; epidemic confidence medium', () => {
  const t = makeHealthContributor(data({
    whoDon: [whoDon()],
    epidemicEvents: [epidemic({ status: 'alert' })],
  })).contribute(NOW);
  const don = t.find((x) => x.sourceEventId.startsWith('whodon-'))!;
  const ep = t.find((x) => x.sourceEventId.startsWith('epidemic-'))!;
  assert.equal(don.confidenceLabel, 'high');
  assert.equal(ep.confidenceLabel, 'medium');
});

test('mixed signals sort worst-first (advisories before watches), ties by id', () => {
  const threats = makeHealthContributor(data({
    whoDon: [whoDon({ id: 'z' }), whoDon({ id: 'a' })],
    epidemicEvents: [
      epidemic({ id: 'e-ongoing', status: 'ongoing' }),
      epidemic({ id: 'e-alert', status: 'alert' }),
      epidemic({ id: 'e-past', status: 'past' }),
    ],
  })).contribute(NOW);
  // Two WHO advisories + one epidemic-alert advisory (all severity 50), then the
  // ongoing epidemic watch (30). Past is dropped. Advisories tie-break by id.
  assert.deepEqual(threats.map((t) => t.severity), [50, 50, 50, 30]);
  assert.deepEqual(
    threats.map((t) => t.sourceEventId),
    ['epidemic-e-alert', 'whodon-a', 'whodon-z', 'epidemic-e-ongoing'],
  );
});

test('every emitted threat is on the health axis with an "other" hazardKind', () => {
  const threats = makeHealthContributor(data({
    whoDon: [whoDon()],
    epidemicEvents: [epidemic({ status: 'alert' })],
  })).contribute(NOW);
  assert.ok(threats.length >= 2);
  for (const t of threats) {
    assert.equal(t.axis, 'health');
    assert.equal(t.hazardKind, 'other');
    assert.equal(t.timeToImpactMins, null);
    assert.equal(t.arrivalLabel, null);
  }
});

test('whoDon alert with missing disease falls back to a generic label', () => {
  const t = makeHealthContributor(data({ whoDon: [whoDon({ disease: '', country: '' })] })).contribute(NOW)[0]!;
  assert.match(t.hazardLabel, /WHO outbreak alert: disease outbreak/);
  assert.doesNotMatch(t.why, / in /);
});
