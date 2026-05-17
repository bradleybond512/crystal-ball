import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  BehavioralResponseModel,
  resetForTests,
  type BehavioralProfile,
} from '../../src/services/intelligence/behavioral-response.ts';
import type { ObservationEvent } from '../../src/services/intelligence/observation-adapters.ts';

const NOW = 1_745_000_000_000;
const HOUR = 60 * 60_000;

function makeEvent(overrides: Partial<ObservationEvent> = {}): ObservationEvent {
  return {
    id: 'ev-' + Math.random().toString(36).slice(2, 8),
    sourceId: 'test',
    domain: 'earthquake',
    timestamp: NOW,
    severity: 'HIGH',
    title: 'Test event',
    raw: null,
    entityIds: ['JP-04'],
    tags: [],
    ...overrides,
  };
}

// ── initProfile ─────────────────────────────────────────────────────

describe('BehavioralResponseModel.initProfile', () => {
  beforeEach(() => { resetForTests(); });

  it('creates a profile with shock phase + seed data point', () => {
    const m = new BehavioralResponseModel({ now: () => NOW });
    const event = makeEvent({ id: 'q-1', severity: 'CRITICAL' });
    const profile = m.initProfile(event);
    assert.equal(profile.phase, 'shock');
    assert.equal(profile.eventId, 'q-1');
    assert.equal(profile.domain, 'earthquake');
    assert.equal(profile.startedAt, NOW);
    assert.equal(profile.dataPoints.length, 1);
    assert.equal(profile.dataPoints[0]?.phase, 'shock');
  });

  it('region is derived from the first entityId prefix', () => {
    const m = new BehavioralResponseModel({ now: () => NOW });
    const profile = m.initProfile(makeEvent({ entityIds: ['JP-04'] }));
    assert.equal(profile.region, 'JP');
  });

  it('falls back to "global" when no entityIds', () => {
    const m = new BehavioralResponseModel({ now: () => NOW });
    const profile = m.initProfile(makeEvent({ entityIds: [] }));
    assert.equal(profile.region, 'global');
  });

  it('stressScore is severity rank divided by 4 (CRITICAL = 1.0)', () => {
    const m = new BehavioralResponseModel({ now: () => NOW });
    assert.equal(m.initProfile(makeEvent({ id: 'a', severity: 'CRITICAL' })).stressScore, 1);
    assert.equal(m.initProfile(makeEvent({ id: 'b', severity: 'HIGH'     })).stressScore, 0.75);
    assert.equal(m.initProfile(makeEvent({ id: 'c', severity: 'MEDIUM'   })).stressScore, 0.5);
    assert.equal(m.initProfile(makeEvent({ id: 'd', severity: 'LOW'      })).stressScore, 0.25);
  });

  it('mobilizationScore starts at 0 and adaptationRate at 0', () => {
    const m = new BehavioralResponseModel({ now: () => NOW });
    const p = m.initProfile(makeEvent());
    assert.equal(p.mobilizationScore, 0);
    assert.equal(p.adaptationRate, 0);
  });

  it('estimatedNormalizationAt projects into the future for a recognized domain', () => {
    const m = new BehavioralResponseModel({ now: () => NOW });
    const p = m.initProfile(makeEvent({ domain: 'earthquake' }));
    assert.ok(p.estimatedNormalizationAt && p.estimatedNormalizationAt > NOW);
  });
});

// ── ingestObservation: profile matching ─────────────────────────────

describe('BehavioralResponseModel.ingestObservation — matching', () => {
  beforeEach(() => { resetForTests(); });

  it('matching obs (same domain + region) updates the existing profile, not creating new', () => {
    const m = new BehavioralResponseModel({ now: () => NOW });
    m.initProfile(makeEvent({ id: 'seed' }));
    m.ingestObservation(makeEvent({ id: 'follow-up' }));
    assert.equal(m.getProfiles().length, 1);
  });

  it('different region spawns a new profile', () => {
    const m = new BehavioralResponseModel({ now: () => NOW });
    m.initProfile(makeEvent({ id: 'seed', entityIds: ['JP-04'] }));
    m.ingestObservation(makeEvent({ id: 'other', entityIds: ['US-CA'] }));
    assert.equal(m.getProfiles().length, 2);
  });

  it('different domain spawns a new profile', () => {
    const m = new BehavioralResponseModel({ now: () => NOW });
    m.initProfile(makeEvent({ id: 'seed', domain: 'earthquake', entityIds: ['JP-04'] }));
    m.ingestObservation(makeEvent({ id: 'other', domain: 'weather', entityIds: ['JP-04'] }));
    assert.equal(m.getProfiles().length, 2);
  });

  it('ingest appends a dataPoint to the existing profile', () => {
    const m = new BehavioralResponseModel({ now: () => NOW });
    m.initProfile(makeEvent({ id: 'seed' }));
    m.ingestObservation(makeEvent({ id: 'follow-up', severity: 'HIGH' }));
    const profile = m.getProfiles()[0]!;
    assert.ok(profile.dataPoints.length >= 2);
  });

  it('ingest with no matching profile creates one on the fly', () => {
    const m = new BehavioralResponseModel({ now: () => NOW });
    m.ingestObservation(makeEvent({ id: 'first' }));
    assert.equal(m.getProfiles().length, 1);
    assert.equal(m.getProfiles()[0]?.eventId, 'first');
  });
});

// ── Phase transitions ───────────────────────────────────────────────

describe('BehavioralResponseModel — phase transitions', () => {
  beforeEach(() => { resetForTests(); });

  it('shock phase: within 6 hours of startedAt', () => {
    let t = NOW;
    const m = new BehavioralResponseModel({ now: () => t });
    m.initProfile(makeEvent({ id: 'a' }));
    t = NOW + 3 * HOUR;
    m.ingestObservation(makeEvent({ id: 'b' }));
    assert.equal(m.getProfiles()[0]?.phase, 'shock');
  });

  it('mobilization phase: 6h–48h after startedAt', () => {
    let t = NOW;
    const m = new BehavioralResponseModel({ now: () => t });
    m.initProfile(makeEvent({ id: 'a' }));
    t = NOW + 24 * HOUR;
    m.ingestObservation(makeEvent({ id: 'b' }));
    assert.equal(m.getProfiles()[0]?.phase, 'mobilization');
  });

  it('adaptation phase: 48h–2wk after startedAt', () => {
    let t = NOW;
    const m = new BehavioralResponseModel({ now: () => t });
    m.initProfile(makeEvent({ id: 'a' }));
    t = NOW + 7 * 24 * HOUR;
    m.ingestObservation(makeEvent({ id: 'b' }));
    assert.equal(m.getProfiles()[0]?.phase, 'adaptation');
  });

  it('normalization phase: past 2 weeks', () => {
    let t = NOW;
    const m = new BehavioralResponseModel({ now: () => t });
    m.initProfile(makeEvent({ id: 'a' }));
    t = NOW + 21 * 24 * HOUR;
    m.ingestObservation(makeEvent({ id: 'b' }));
    assert.equal(m.getProfiles()[0]?.phase, 'normalization');
  });

  it('resilience phase requires explicit promotion via observed improvement', () => {
    let t = NOW;
    const m = new BehavioralResponseModel({ now: () => t });
    m.initProfile(makeEvent({ id: 'a', severity: 'CRITICAL' }));
    // Long normalization with steady LOW severity → resilience.
    t = NOW + 30 * 24 * HOUR;
    for (let i = 0; i < 5; i++) {
      m.ingestObservation(makeEvent({ id: `r-${i}`, severity: 'LOW' }));
      t += HOUR;
    }
    assert.equal(m.getProfiles()[0]?.phase, 'resilience');
  });

  it('each dataPoint records the phase at observation time', () => {
    let t = NOW;
    const m = new BehavioralResponseModel({ now: () => t });
    m.initProfile(makeEvent({ id: 'seed' }));
    t = NOW + 24 * HOUR;
    m.ingestObservation(makeEvent({ id: 'mob' }));
    const profile = m.getProfiles()[0]!;
    const mobPoint = profile.dataPoints.find((p) => p.phase === 'mobilization');
    assert.ok(mobPoint);
  });
});

// ── Score updates ───────────────────────────────────────────────────

describe('BehavioralResponseModel — score updates', () => {
  beforeEach(() => { resetForTests(); });

  it('stressScore tracks the maximum severity observed', () => {
    let t = NOW;
    const m = new BehavioralResponseModel({ now: () => t });
    m.initProfile(makeEvent({ id: 'a', severity: 'MEDIUM' })); // 0.5
    t += HOUR;
    m.ingestObservation(makeEvent({ id: 'b', severity: 'CRITICAL' })); // → 1.0
    assert.equal(m.getProfiles()[0]?.stressScore, 1);
    t += HOUR;
    m.ingestObservation(makeEvent({ id: 'c', severity: 'LOW' })); // unchanged
    assert.equal(m.getProfiles()[0]?.stressScore, 1);
  });

  it('mobilizationScore increases with observation volume in mobilization phase', () => {
    let t = NOW;
    const m = new BehavioralResponseModel({ now: () => t });
    m.initProfile(makeEvent({ id: 'a' }));
    t = NOW + 24 * HOUR;
    for (let i = 0; i < 5; i++) {
      m.ingestObservation(makeEvent({ id: `m-${i}` }));
      t += HOUR;
    }
    const profile = m.getProfiles()[0]!;
    assert.ok(profile.mobilizationScore > 0);
  });

  it('adaptationRate is positive when severity declines in adaptation phase', () => {
    let t = NOW;
    const m = new BehavioralResponseModel({ now: () => t });
    m.initProfile(makeEvent({ id: 'a', severity: 'CRITICAL' }));
    t = NOW + 3 * 24 * HOUR; // 72h into adaptation
    m.ingestObservation(makeEvent({ id: 'b', severity: 'MEDIUM' }));
    t += HOUR;
    m.ingestObservation(makeEvent({ id: 'c', severity: 'LOW' }));
    const profile = m.getProfiles()[0]!;
    assert.ok(profile.adaptationRate > 0, `expected >0, got ${profile.adaptationRate}`);
  });

  it('estimatedNormalizationAt is set on init and stable thereafter', () => {
    let t = NOW;
    const m = new BehavioralResponseModel({ now: () => t });
    m.initProfile(makeEvent({ id: 'a' }));
    const initialEst = m.getProfiles()[0]!.estimatedNormalizationAt;
    t += 6 * HOUR;
    m.ingestObservation(makeEvent({ id: 'b' }));
    assert.equal(m.getProfiles()[0]!.estimatedNormalizationAt, initialEst);
  });
});

// ── Domain templates ────────────────────────────────────────────────

describe('BehavioralResponseModel — domain templates', () => {
  beforeEach(() => { resetForTests(); });

  it('covers 8 domains with distinct phase-duration profiles', () => {
    const domains = [
      'earthquake', 'weather', 'biosurveillance', 'cyber',
      'maritime', 'aviation', 'space-weather', 'geopolitical',
    ];
    const m = new BehavioralResponseModel({ now: () => NOW });
    const estimates = new Set<number>();
    for (const domain of domains) {
      const p = m.initProfile(makeEvent({ id: `${domain}-1`, domain, entityIds: [`${domain}-ent`] }));
      assert.ok(p.estimatedNormalizationAt, `${domain} should have an estimate`);
      estimates.add(p.estimatedNormalizationAt!);
    }
    // Templates should have at least 4 distinct normalization horizons.
    assert.ok(estimates.size >= 4, `expected ≥4 distinct horizons, got ${estimates.size}`);
  });

  it('unknown domain still gets a default template and estimate', () => {
    const m = new BehavioralResponseModel({ now: () => NOW });
    const p = m.initProfile(makeEvent({ id: 'a', domain: 'mystery-domain' }));
    assert.ok(p.estimatedNormalizationAt && p.estimatedNormalizationAt > NOW);
  });
});

// ── Accessors ───────────────────────────────────────────────────────

describe('BehavioralResponseModel — accessors', () => {
  beforeEach(() => { resetForTests(); });

  it('getProfiles(domain) filters by domain', () => {
    const m = new BehavioralResponseModel({ now: () => NOW });
    m.initProfile(makeEvent({ id: 'a', domain: 'earthquake', entityIds: ['JP-04'] }));
    m.initProfile(makeEvent({ id: 'b', domain: 'weather',    entityIds: ['US-FL'] }));
    assert.equal(m.getProfiles('earthquake').length, 1);
    assert.equal(m.getProfiles('weather').length, 1);
    assert.equal(m.getProfiles('cyber').length, 0);
  });

  it('getActiveProfiles excludes normalization + resilience', () => {
    let t = NOW;
    const m = new BehavioralResponseModel({ now: () => t });
    m.initProfile(makeEvent({ id: 'a', entityIds: ['JP-04'] }));
    m.initProfile(makeEvent({ id: 'b', entityIds: ['US-CA'] }));
    t = NOW + 21 * 24 * HOUR;
    m.ingestObservation(makeEvent({ id: 'older', entityIds: ['JP-04'] })); // flips to normalization
    const active = m.getActiveProfiles();
    assert.equal(active.length, 1);
    assert.equal(active[0]?.region, 'US');
  });

  it('stats includes avg adaptationRate by domain', () => {
    let t = NOW;
    const m = new BehavioralResponseModel({ now: () => t });
    m.initProfile(makeEvent({ id: 'a', severity: 'CRITICAL' }));
    t = NOW + 3 * 24 * HOUR;
    m.ingestObservation(makeEvent({ id: 'b', severity: 'MEDIUM' }));
    t += HOUR;
    m.ingestObservation(makeEvent({ id: 'c', severity: 'LOW' }));
    const s = m.stats();
    assert.ok(typeof s.avgAdaptationRateByDomain.earthquake === 'number');
  });

  it('stats includes mostResilientRegions (top by adaptation rate)', () => {
    let t = NOW;
    const m = new BehavioralResponseModel({ now: () => t });
    m.initProfile(makeEvent({ id: 'a', entityIds: ['JP-04'], severity: 'CRITICAL' }));
    t = NOW + 3 * 24 * HOUR;
    m.ingestObservation(makeEvent({ id: 'b', entityIds: ['JP-04'], severity: 'LOW' }));
    const s = m.stats();
    assert.ok(Array.isArray(s.mostResilientRegions));
  });

  it('stats avgShockDurationHours is a number', () => {
    const m = new BehavioralResponseModel({ now: () => NOW });
    m.initProfile(makeEvent({ id: 'a' }));
    assert.equal(typeof m.stats().avgShockDurationHours, 'number');
  });
});

// ── Subscribe ───────────────────────────────────────────────────────

describe('BehavioralResponseModel — subscribe', () => {
  beforeEach(() => { resetForTests(); });

  it('subscribe fires on initProfile and ingestObservation', () => {
    const m = new BehavioralResponseModel({ now: () => NOW });
    let calls = 0;
    let last: BehavioralProfile | null = null;
    m.subscribe((p) => { calls++; last = p; });
    m.initProfile(makeEvent({ id: 'a' }));
    assert.equal(calls, 1);
    m.ingestObservation(makeEvent({ id: 'b' }));
    assert.equal(calls, 2);
    assert.ok(last);
  });

  it('unsubscribe stops further callbacks', () => {
    const m = new BehavioralResponseModel({ now: () => NOW });
    let calls = 0;
    const cb = () => { calls++; };
    m.subscribe(cb);
    m.initProfile(makeEvent({ id: 'a' }));
    m.unsubscribe(cb);
    m.ingestObservation(makeEvent({ id: 'b' }));
    assert.equal(calls, 1);
  });

  it('subscribe disposer also unsubscribes', () => {
    const m = new BehavioralResponseModel({ now: () => NOW });
    let calls = 0;
    const off = m.subscribe(() => { calls++; });
    m.initProfile(makeEvent({ id: 'a' }));
    off();
    m.ingestObservation(makeEvent({ id: 'b' }));
    assert.equal(calls, 1);
  });
});

// ── Persistence ─────────────────────────────────────────────────────

describe('BehavioralResponseModel — persistence', () => {
  beforeEach(() => { resetForTests(); });

  it('persists to and restores from a storage seam', () => {
    const fakeStorage: Record<string, string> = {};
    const storage = {
      getItem: (k: string) => fakeStorage[k] ?? null,
      setItem: (k: string, v: string) => { fakeStorage[k] = v; },
    };
    const a = new BehavioralResponseModel({ now: () => NOW, storage });
    a.initProfile(makeEvent({ id: 'persisted', entityIds: ['JP-04'] }));
    const b = new BehavioralResponseModel({ now: () => NOW, storage });
    assert.equal(b.getProfiles().length, 1);
    assert.equal(b.getProfiles()[0]?.region, 'JP');
  });

  it('ring buffer caps profiles at supplied capacity', () => {
    const m = new BehavioralResponseModel({ now: () => NOW, capacity: 3 });
    for (let i = 0; i < 5; i++) {
      m.initProfile(makeEvent({ id: `e-${i}`, entityIds: [`R${i}-x`] }));
    }
    assert.ok(m.getProfiles().length <= 3);
  });

  it('corrupted storage falls back to empty', () => {
    const storage = { getItem: () => '{not-json', setItem: () => {} };
    const m = new BehavioralResponseModel({ now: () => NOW, storage });
    assert.equal(m.getProfiles().length, 0);
  });
});
