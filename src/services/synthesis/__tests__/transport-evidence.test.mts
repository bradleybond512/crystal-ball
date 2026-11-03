import assert from 'node:assert/strict';
import test from 'node:test';
import { ThreatEvidenceStore } from '../threat-aggregator.ts';
import { aisReceipt, faaReceipt, sigmetReceipt } from '../transport-evidence.ts';

const now = 1_800_000_000_000;
const minute = 60_000;
const sigmet = { id: 'A', isAirmet: false, hazard: 'volcanic_ash', validFrom: now - minute, validTo: now + minute };
const faa = { airport: 'KJFK', programType: 'ground_stop', startedAt: null, endsAt: now + 500 };
function envelope(source: string, data: unknown[], extra = {}) {
  return { source, data, fetchedAt: now - 10_000, degraded: false, ...extra };
}
const ais = { mmsi: '367123456', name: 'OLD', observedAt: now - 14 * minute, zoneId: 'south-china-sea', lat: 0, lon: 110 };

test('AWC reports active SIGMETs on partial upstream failure, with actual fetch age and advisory expiry', () => {
  const r = sigmetReceipt(envelope('aviationweather.gov', [sigmet, sigmet, { ...sigmet, id: 'B', isAirmet: true }, { ...sigmet, id: 'C', hazard: 'new' }], { degraded: true }), now);
  assert.ok(r);
  assert.deepEqual([r.ageKind, r.evidenceAtMs, r.scope, r.degraded], ['fetched', now - 10_000, 'partial', true]);
  assert.equal(r.evaluate(now).topAlert, '1 SIGMET (1 ash)');
  assert.equal(r.expiresAtMs, sigmet.validTo);
  assert.equal(r.evaluate(sigmet.validTo).level, 'NONE');
});

test('aviation fails closed for wrong source, stale/future envelope, wrong type, expired or absent rows', () => {
  for (const e of [envelope('unknown', [sigmet]), envelope('aviationweather.gov', [sigmet], { fetchedAt: now + 1 }), envelope('aviationweather.gov', [sigmet], { fetchedAt: now - 5 * minute }), envelope('aviationweather.gov', [sigmet], { degraded: 'false' }), envelope('aviationweather.gov', [null, { ...sigmet, isAirmet: undefined }, { ...sigmet, validFrom: now + 1 }, { ...sigmet, validTo: now }, { ...sigmet, validTo: Infinity }]), envelope('aviationweather.gov', [])]) {
    assert.equal(sigmetReceipt(e, now), null);
  }
});

test('FAA admits only explicit active airport ground stops and bounds untimed stops at fetch freshness', () => {
  const r = faaReceipt(envelope('nasstatus.faa.gov', [faa, { ...faa, airport: 'LAX', programType: 'ground_delay' }, { ...faa, airport: 'ORD', startedAt: now + 10 }, { ...faa, airport: 'DEN', endsAt: now }, { ...faa, airport: 'SFO', endsAt: undefined }]), now);
  assert.ok(r);
  assert.equal(r.evaluate(now).topAlert, 'KJFK ground stop');
  assert.equal(r.expiresAtMs, now + 500);
  assert.equal(r.evaluate(now + 500).level, 'NONE');
  assert.equal(faaReceipt(envelope('nasstatus.faa.gov', [{ ...faa, programType: 'ground_delay' }]), now), null);
  assert.equal(faaReceipt(envelope('nasstatus.faa.gov', [{ ...faa, startedAt: now + 1 }]), now), null);
  const ongoing = faaReceipt(envelope('nasstatus.faa.gov', [{ ...faa, endsAt: null }]), now);
  assert.equal(ongoing?.expiresAtMs, now - 10_000 + 5 * minute);
  assert.equal(faaReceipt(envelope('nasstatus.faa.gov', [{ ...faa, airport: 'bad airport' }, { ...faa, endsAt: 'bad' }]), now), null);
});

test('AIS uses the newest receipt per MMSI and expires individual positions on the four-zone 15 minute horizon', () => {
  const rows = [ais, { ...ais, name: 'LATEST', observedAt: now - minute }, ais, { ...ais, name: 'SECOND', mmsi: '366123456' }, { ...ais, mmsi: '000000000' }, { ...ais, mmsi: '367111111', zoneId: 'unknown' }, { ...ais, mmsi: '367111112', lon: -110 }, { ...ais, mmsi: '367111113', observedAt: now + 1 }];
  const r = aisReceipt({ asOf: new Date(now).toISOString(), sampleSize: rows.length, vessels: rows }, now);
  assert.ok(r);
  assert.deepEqual([r.ageKind, r.evidenceAtMs, r.scope], ['received', now - minute, 'partial']);
  assert.equal(r.evaluate(now).topAlert, '2 in red zone (incl. LATEST)');
  assert.equal(r.evaluate(now + minute).topAlert, '1 in red zone: LATEST');
  assert.equal(r.expiresAtMs, now + 14 * minute);
  assert.equal(r.evaluate(r.expiresAtMs).level, 'NONE');
});

test('AIS envelope generation, empty samples and invalid timestamps never certify coverage', () => {
  for (const body of [{ asOf: new Date(now).toISOString(), sampleSize: 10, vessels: [] }, { sampleSize: 0, vessels: [ais] }, { sampleSize: 2, vessels: [{ ...ais, observedAt: now - 15 * minute }, { ...ais, observedAt: null }] }, { sampleSize: 1, vessels: 'bad' }, null]) {
    assert.equal(aisReceipt(body, now), null);
  }
});

test('a newer AIS snapshot revises membership while preserving original position age and expiry', () => {
  let clock = now;
  const store = new ThreatEvidenceStore(() => clock);
  const vessels = Array.from({ length: 6 }, (_, i) => ({ ...ais, mmsi: String(367100000 + i), name: 'V' + i }));
  const asOf = (t: number) => new Date(t).toISOString();
  const apply = (rows: typeof vessels, revision: unknown) => {
    const attempt = store.begin('maritime', 'Four-zone AIS');
    const receipt = aisReceipt({ vessels: rows, sampleSize: 6, asOf: revision }, clock);
    if (receipt) attempt.report(receipt);
    else attempt.fail();
    return store.sample().maritime;
  };
  assert.equal(apply(vessels, asOf(now)).level, 'HIGH');
  clock += 1_000;
  const revised = apply(vessels.slice(0, 5), asOf(clock));
  assert.equal(revised.level, 'ELEVATED');
  assert.equal(revised.topAlert, '5 in red zone (incl. V0)');
  assert.equal(revised.lastUpdatedMs, ais.observedAt);
  const conflict = apply(vessels, asOf(now));
  assert.equal(conflict.level, 'ELEVATED');
  assert.equal(conflict.lastKnown, true);
  clock += 1_000;
  assert.equal(apply(vessels.slice(0, 5).reverse(), asOf(clock)).lastKnown, true, 'same content with a newer asOf cannot clear failure');
  assert.equal(apply(vessels, asOf(clock)).lastKnown, true, 'conflict at the same revision cannot clear failure');
  clock += 1_000;
  const resumed = apply(vessels, asOf(clock));
  assert.equal(resumed.lastKnown, false);
  assert.equal(resumed.level, 'HIGH');
  assert.equal(resumed.lastUpdatedMs, ais.observedAt);
  clock = ais.observedAt + 15 * minute;
  assert.equal(store.sample().maritime.level, 'NONE');
  assert.equal(store.sample().maritime.coverage, 'stale');
});

test('missing, malformed, future and pre-position AIS snapshot revisions cannot order membership changes', () => {
  for (const asOf of [null, '', 42, '2026-02-31T01:00:00.000Z', new Date(now).toUTCString(), new Date(now + 1).toISOString(), new Date(ais.observedAt - 1).toISOString()]) {
    assert.equal(aisReceipt({ asOf, vessels: [ais], sampleSize: 1 }, now), null);
  }
});

test('a newer AIS snapshot can remove the newest departing vessel and use the older remaining report age', () => {
  let clock = now;
  const store = new ThreatEvidenceStore(() => clock);
  const vessels = Array.from({ length: 6 }, (_, i) => ({
    ...ais, mmsi: String(367100000 + i), observedAt: i === 0 ? now - minute : ais.observedAt,
  }));
  const apply = (rows: typeof vessels, revision: number) => {
    const receipt = aisReceipt({ vessels: rows, sampleSize: 6, asOf: new Date(revision).toISOString() }, clock);
    assert.ok(receipt);
    store.begin('maritime', 'Four-zone AIS').report(receipt);
    return store.sample().maritime;
  };
  assert.equal(apply(vessels, now).level, 'HIGH');
  clock += 1_000;
  const remaining = apply(vessels.slice(1), clock);
  assert.equal(remaining.level, 'ELEVATED');
  assert.equal(remaining.lastUpdatedMs, ais.observedAt);
  assert.equal(remaining.lastKnown, false);
  const replay = apply(vessels, now);
  assert.equal(replay.level, 'ELEVATED', 'an old snapshot with newer positions cannot resurrect a departed vessel');
  assert.equal(replay.lastUpdatedMs, ais.observedAt);
  clock = ais.observedAt + 15 * minute;
  assert.equal(store.sample().maritime.level, 'NONE');
});
