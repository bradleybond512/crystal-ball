import test from 'node:test';
import assert from 'node:assert/strict';
import { SeismicThreatHistory, kpThreatReceipt } from '../geo-threat-evidence.ts';
import { fetchSwpcKp, fetchGfzKp } from '../../spaceweather/gfz-kp-fetch.ts';
import { kpVote, KP_BIN_MS } from '../../spaceweather/kp-fusion-observations.ts';

const BIN = Date.parse('2026-11-02T18:00:00Z');
const HOUR = 60 * 60 * 1000;

function quake(id: string, magnitude: number, time: number) {
  return { id, magnitude, time, place: id, lat: 0, lon: 0, magnitudeType: null, depthKm: null };
}

function feed(generatedAtMs: number, events: ReturnType<typeof quake>[], originNowMs = generatedAtMs) {
  return { generatedAtMs, originNowMs, events, dashboardEvents: events, degraded: false };
}

test('USGS receipt ages the acquisition and the event against the origin despite a slow local clock', () => {
  const local = BIN - 20 * HOUR;
  const r = new SeismicThreatHistory().admit(feed(BIN - 40_000, [quake('ridge', 6.1, BIN - 2 * HOUR)], BIN), local)!;
  assert.equal(r.evidenceAtMs, local - 40_000);
  assert.equal(r.expiresAtMs, local - 40_000 + 600_000);
  assert.equal(r.scope, 'partial');
  assert.equal(r.ageKind, 'fetched');
  assert.match(r.evaluate(local).topAlert!, /ridge.*2h ago/);
});

test('a narrower USGS refresh retains a strong observation until its event horizon; corrections replace by ID', () => {
  const h = new SeismicThreatHistory();
  const older = quake('old', 7.1, BIN - 24 * HOUR + 120_000);
  h.admit(feed(BIN, [older]), BIN);
  const next = h.admit(feed(BIN + 60_000, [quake('new', 4.0, BIN)]), BIN + 60_000)!;
  assert.match(next.evaluate(BIN + 60_000).topAlert!, /old/);
  assert.match(next.evaluate(BIN + 120_001).topAlert!, /new/);
  const correction = h.admit(feed(BIN + 80_000, [{ ...older, magnitude: 2 }]), BIN + 80_000)!;
  assert.match(correction.evaluate(BIN + 80_000).topAlert!, /new/);
});

test('an equal cached generation cannot restamp and an older generation cannot replace observations', () => {
  const h = new SeismicThreatHistory();
  const original = h.admit(feed(BIN, [quake('ridge', 6.1, BIN)]), BIN)!;
  const replay = h.admit(feed(BIN, [quake('bogus', 9, BIN)], BIN + 1000), BIN + 90_000)!;
  assert.equal(replay.evidenceAtMs, original.evidenceAtMs);
  assert.match(replay.evaluate(BIN + 90_000).topAlert!, /ridge/);
  assert.equal(h.admit(feed(BIN - 1, [quake('bad', 9, BIN - 1)]), BIN + 100_000), null);
});

test('empty, impossible coordinates, expired and future event times supply no USGS receipt', () => {
  for (const events of [[], [{ ...quake('bad', 5, BIN), lon: 181 }], [quake('old', 7, BIN - 25 * HOUR)], [quake('future', 7, BIN + HOUR)]]) {
    assert.equal(new SeismicThreatHistory().admit(feed(BIN, events), BIN), null);
  }
});

test('current source Kp bin is partial, zero is a reading, older storm and future/skewed bins cannot win', () => {
  const samples = [{ observedAt: BIN - KP_BIN_MS, kp: 9 }, { observedAt: BIN, kp: 0 },
    { observedAt: BIN + KP_BIN_MS, kp: 9 }, { observedAt: BIN + 1, kp: 9 }];
  const r = kpThreatReceipt(kpVote('swpc-kp', true, samples), BIN + 1_000)!;
  assert.equal(r.evidenceAtMs, BIN);
  assert.equal(r.expiresAtMs, BIN + KP_BIN_MS);
  assert.equal(r.ageKind, 'observed');
  assert.equal(r.scope, 'partial');
  assert.equal(r.evaluate(BIN + 1_000).level, 'NONE');
});

test('failed, conflicting and sentinel Kp are withheld; a sampled expired bin keeps its original expiry', () => {
  const sample = { observedAt: BIN, kp: 8 };
  assert.equal(kpThreatReceipt(kpVote('gfz-kp', false, [sample]), BIN), null);
  assert.equal(kpThreatReceipt(kpVote('gfz-kp', true, [{ ...sample, kp: -1 }]), BIN), null);
  assert.equal(kpThreatReceipt(kpVote('gfz-kp', true, [sample, { ...sample, kp: 0 }]), BIN), null);
  const r = kpThreatReceipt(kpVote('gfz-kp', true, [sample, sample]), BIN + KP_BIN_MS)!;
  assert.equal(r.expiresAtMs, BIN + KP_BIN_MS);
  assert.equal(r.evaluate(BIN).level, 'HIGH');
});

test('both Kp fetch routes preserve the frozen acquisition clock independently of bin time and summary time', async (t) => {
  const now = BIN + 60_000;
  const fetched = BIN + 10_000;
  const kpPoints = [{ time_tag: new Date(BIN).toISOString(), kp: 0 }];
  const samples = [{ observedAt: BIN, kp: 0 }];
  const noClock = { kpPoints, asOf: new Date(now).toISOString() };
  let bodies: unknown[] = [{ ...noClock, kpFetchedAt: fetched }, { samples, fetchedAt: fetched }];
  t.mock.method(globalThis, 'fetch', async () => Response.json(bodies.shift()));
  const swpc = await fetchSwpcKp(now);
  const gfz = await fetchGfzKp(now);
  for (const leg of [swpc, gfz]) {
    assert.equal(leg.fetchedAtMs, fetched);
    const receipt = kpThreatReceipt(kpVote('test', leg.ok, leg.samples), now, leg.fetchedAtMs)!;
    assert.equal(receipt.revisionKey, '0');
    assert.equal(receipt.revisionAtMs, fetched);
    assert.equal(receipt.evidenceAtMs, BIN);
    assert.equal(receipt.expiresAtMs, BIN + KP_BIN_MS);
  }
  for (const invalid of [undefined, now + 1, BIN - 1, '123', null]) {
    bodies = [{ ...noClock, kpFetchedAt: invalid }];
    const leg = await fetchSwpcKp(now);
    const receipt = kpThreatReceipt(kpVote('test', leg.ok, leg.samples), now, leg.fetchedAtMs)!;
    assert.equal(receipt.revisionAtMs, undefined);
    assert.equal(receipt.revisionKey, '0');
  }
});
