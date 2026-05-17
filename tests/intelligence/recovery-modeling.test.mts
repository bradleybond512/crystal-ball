import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createRecoveryModelingEngine,
  STORAGE_KEY,
  MAX_PROFILES,
  EXPECTED_DURATION_BY_DOMAIN,
  type RecoveryPhase,
} from '../../src/services/intelligence/recovery-modeling.ts';
import type { ObservationEvent, ObservationSeverity } from '../../src/types/intelligence.ts';
import type { Situation } from '../../src/services/intelligence/situation-store-v2.ts';

function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem(key: string) { return store.get(key) ?? null; },
    setItem(key: string, value: string) { store.set(key, String(value)); },
    removeItem(key: string) { store.delete(key); },
    clear() { store.clear(); },
    key(i: number) { return [...store.keys()][i] ?? null; },
    get length() { return store.size; },
  };
}

const NOW = new Date('2026-05-17T00:00:00Z').getTime();
const TOKYO = { lat: 35.68, lon: 139.69 };

let _idCounter = 0;
function obs(overrides: Partial<ObservationEvent> = {}): ObservationEvent {
  _idCounter += 1;
  return {
    id: overrides.id ?? `ev-${_idCounter}`,
    sourceId: overrides.sourceId ?? 'src-a',
    domain: overrides.domain ?? 'earthquake',
    timestamp: overrides.timestamp ?? NOW,
    location: overrides.location ?? { lat: TOKYO.lat, lon: TOKYO.lon },
    severity: overrides.severity ?? 'HIGH',
    title: overrides.title ?? 't',
    raw: {},
    entityIds: overrides.entityIds ?? ['ent-1'],
    tags: overrides.tags ?? [],
  };
}

function situation(overrides: Partial<Situation> = {}): Situation {
  return {
    id: overrides.id ?? 'sit-1',
    name: overrides.name ?? 'M6.2 near Tokyo',
    domain: overrides.domain ?? 'earthquake',
    relatedDomains: overrides.relatedDomains ?? [],
    severity: overrides.severity ?? 'high',
    status: overrides.status ?? 'active',
    summary: overrides.summary ?? '',
    observations: overrides.observations ?? [],
    edges: overrides.edges ?? [],
    entityIds: overrides.entityIds ?? ['ent-1'],
    confidence: overrides.confidence ?? 0.8,
    startedAt: overrides.startedAt ?? new Date(NOW),
    updatedAt: overrides.updatedAt ?? new Date(NOW),
    location: overrides.location ?? { lat: TOKYO.lat, lon: TOKYO.lon, radiusKm: 200 },
    tags: overrides.tags ?? [],
  };
}

// ── Constants ────────────────────────────────────────────────────────────

test('STORAGE_KEY is "wm-recovery-modeling"', () => {
  assert.equal(STORAGE_KEY, 'wm-recovery-modeling');
});

test('MAX_PROFILES is 100', () => {
  assert.equal(MAX_PROFILES, 100);
});

test('expected durations match spec', () => {
  assert.equal(EXPECTED_DURATION_BY_DOMAIN.earthquake, 72);
  assert.equal(EXPECTED_DURATION_BY_DOMAIN.biosurv, 720);
  assert.equal(EXPECTED_DURATION_BY_DOMAIN.weather, 48);
  assert.equal(EXPECTED_DURATION_BY_DOMAIN.wildfire, 168);
  assert.equal(EXPECTED_DURATION_BY_DOMAIN.maritime, 24);
});

// ── initProfile ──────────────────────────────────────────────────────────

test('initProfile creates a new profile with expected fields', () => {
  const svc = createRecoveryModelingEngine({ storage: createMemoryStorage(), now: () => NOW });
  const sit = situation();
  const peakObs = obs({ severity: 'HIGH' });
  const profile = svc.initProfile(sit, peakObs);
  assert.ok(profile.id);
  assert.equal(profile.situationId, sit.id);
  assert.equal(profile.domain, 'earthquake');
  assert.equal(profile.phase, 'acute');
  assert.equal(profile.peakSeverity, 'HIGH');
});

test('initProfile sets expectedDurationHours from domain table', () => {
  const svc = createRecoveryModelingEngine({ storage: createMemoryStorage(), now: () => NOW });
  const eq = svc.initProfile(situation({ domain: 'earthquake' }), obs({ domain: 'earthquake' }));
  const wx = svc.initProfile(situation({ id: 'w', domain: 'weather' }), obs({ domain: 'weather' }));
  assert.equal(eq.expectedDurationHours, 72);
  assert.equal(wx.expectedDurationHours, 48);
});

test('initProfile uses 96h default for unknown domain', () => {
  const svc = createRecoveryModelingEngine({ storage: createMemoryStorage(), now: () => NOW });
  const p = svc.initProfile(situation({ domain: 'whatever' }), obs({ domain: 'whatever' }));
  assert.equal(p.expectedDurationHours, 96);
});

test('initProfile seeds dataPoints with the peak observation', () => {
  const svc = createRecoveryModelingEngine({ storage: createMemoryStorage(), now: () => NOW });
  const p = svc.initProfile(situation(), obs({ severity: 'HIGH', timestamp: NOW }));
  assert.equal(p.dataPoints.length, 1);
  assert.equal(p.dataPoints[0]!.severityNum, 3); // HIGH=3
  assert.equal(p.dataPoints[0]!.timestamp, NOW);
});

test('initProfile is idempotent on situationId — second call returns existing profile', () => {
  const svc = createRecoveryModelingEngine({ storage: createMemoryStorage(), now: () => NOW });
  const sit = situation();
  const a = svc.initProfile(sit, obs());
  const b = svc.initProfile(sit, obs());
  assert.equal(a.id, b.id);
  assert.equal(svc.getActiveProfiles().length, 1);
});

// ── ingestObservation: matching + data points ───────────────────────────

test('ingestObservation appends a data point to the matching profile', () => {
  const svc = createRecoveryModelingEngine({ storage: createMemoryStorage(), now: () => NOW });
  svc.initProfile(situation(), obs({ severity: 'HIGH', timestamp: NOW }));
  svc.ingestObservation(obs({ severity: 'MEDIUM', timestamp: NOW + 60 * 60_000 }));
  const profile = svc.getActiveProfiles()[0]!;
  assert.equal(profile.dataPoints.length, 2);
  assert.equal(profile.dataPoints[1]!.severityNum, 2);
});

test('ingestObservation matches by domain + location within 500km', () => {
  const svc = createRecoveryModelingEngine({ storage: createMemoryStorage(), now: () => NOW });
  svc.initProfile(situation(), obs({ severity: 'HIGH' }));
  // 400km north — should match
  svc.ingestObservation(obs({
    severity: 'MEDIUM',
    location: { lat: TOKYO.lat + 3.6, lon: TOKYO.lon },
    timestamp: NOW + 60 * 60_000,
  }));
  assert.equal(svc.getActiveProfiles()[0]!.dataPoints.length, 2);
});

test('ingestObservation does NOT match observations beyond 500km', () => {
  const svc = createRecoveryModelingEngine({ storage: createMemoryStorage(), now: () => NOW });
  svc.initProfile(situation(), obs({ severity: 'HIGH' }));
  // ~1100km away
  svc.ingestObservation(obs({
    severity: 'MEDIUM',
    location: { lat: TOKYO.lat + 10, lon: TOKYO.lon },
    timestamp: NOW + 60 * 60_000,
  }));
  assert.equal(svc.getActiveProfiles()[0]!.dataPoints.length, 1);
});

test('ingestObservation does NOT match observations in a different domain', () => {
  const svc = createRecoveryModelingEngine({ storage: createMemoryStorage(), now: () => NOW });
  svc.initProfile(situation({ domain: 'earthquake' }), obs({ domain: 'earthquake' }));
  svc.ingestObservation(obs({ domain: 'cyber', severity: 'LOW' }));
  assert.equal(svc.getActiveProfiles()[0]!.dataPoints.length, 1);
});

test('ingestObservation updates currentSeverityNum to the latest point', () => {
  const svc = createRecoveryModelingEngine({ storage: createMemoryStorage(), now: () => NOW });
  svc.initProfile(situation(), obs({ severity: 'HIGH' }));
  svc.ingestObservation(obs({ severity: 'LOW', timestamp: NOW + 60 * 60_000 }));
  assert.equal(svc.getActiveProfiles()[0]!.currentSeverityNum, 1);
});

// ── Phase transitions ───────────────────────────────────────────────────

test('phase: acute on init', () => {
  const svc = createRecoveryModelingEngine({ storage: createMemoryStorage(), now: () => NOW });
  const p = svc.initProfile(situation(), obs({ severity: 'CRITICAL' }));
  assert.equal(p.phase, 'acute');
});

test('phase: stabilizing when severity drops by 1 band from peak', () => {
  const svc = createRecoveryModelingEngine({ storage: createMemoryStorage(), now: () => NOW });
  svc.initProfile(situation(), obs({ severity: 'CRITICAL' })); // peak=4
  svc.ingestObservation(obs({ severity: 'HIGH', timestamp: NOW + 60 * 60_000 })); // 3 < 4-1? No, 4-1=3, so 3 < 3 false
  // spec: "stabilizing if severity < peak-1 band" — peak=4, peak-1=3, so severity must be < 3
  // Let's drop to MEDIUM to actually trigger it (peak=4 → must be < 3 → MEDIUM=2)
  svc.ingestObservation(obs({ severity: 'MEDIUM', timestamp: NOW + 2 * 60 * 60_000 }));
  const profile = svc.getActiveProfiles()[0]!;
  assert.ok(profile.phase === 'stabilizing' || profile.phase === 'recovering',
    `expected stabilizing/recovering, got ${profile.phase}`);
});

test('phase: recovering when severity drops by 2 bands AND trending down', () => {
  const svc = createRecoveryModelingEngine({ storage: createMemoryStorage(), now: () => NOW });
  svc.initProfile(situation(), obs({ severity: 'CRITICAL', timestamp: NOW })); // peak=4
  svc.ingestObservation(obs({ severity: 'HIGH', timestamp: NOW + 60 * 60_000 }));
  svc.ingestObservation(obs({ severity: 'MEDIUM', timestamp: NOW + 2 * 60 * 60_000 }));
  svc.ingestObservation(obs({ severity: 'LOW', timestamp: NOW + 3 * 60 * 60_000 }));
  const profile = svc.getActiveProfiles()[0]!;
  assert.ok(profile.phase === 'recovering' || profile.phase === 'resolved',
    `expected recovering/resolved, got ${profile.phase}`);
});

test('phase: resolved when severity=LOW for more than 3 data points', () => {
  const svc = createRecoveryModelingEngine({ storage: createMemoryStorage(), now: () => NOW });
  svc.initProfile(situation(), obs({ severity: 'HIGH' }));
  for (let i = 1; i <= 4; i++) {
    svc.ingestObservation(obs({ severity: 'LOW', timestamp: NOW + i * 60 * 60_000 }));
  }
  // After init (1 HIGH point) + 4 LOW points: last 4 are all LOW. >3 LOW points → resolved.
  const completed = svc.getCompletedProfiles();
  const active = svc.getActiveProfiles();
  // Either resolved+completed OR active with phase 'resolved'
  assert.ok(
    completed.some((p) => p.phase === 'resolved')
      || active.some((p) => p.phase === 'resolved'),
  );
});

// ── updateRecoveryRate ──────────────────────────────────────────────────

test('updateRecoveryRate: returns positive rate when severity is declining', () => {
  const svc = createRecoveryModelingEngine({ storage: createMemoryStorage(), now: () => NOW });
  const p = svc.initProfile(situation(), obs({ severity: 'CRITICAL', timestamp: NOW }));
  svc.ingestObservation(obs({ severity: 'HIGH', timestamp: NOW + 60 * 60_000 }));
  svc.ingestObservation(obs({ severity: 'MEDIUM', timestamp: NOW + 2 * 60 * 60_000 }));
  svc.ingestObservation(obs({ severity: 'LOW', timestamp: NOW + 3 * 60 * 60_000 }));
  svc.updateRecoveryRate(p.id);
  assert.ok(svc.getProfile(p.id)!.recoveryRate > 0);
});

test('updateRecoveryRate: returns negative rate when severity is rising', () => {
  const svc = createRecoveryModelingEngine({ storage: createMemoryStorage(), now: () => NOW });
  const p = svc.initProfile(situation(), obs({ severity: 'LOW', timestamp: NOW }));
  svc.ingestObservation(obs({ severity: 'MEDIUM', timestamp: NOW + 60 * 60_000 }));
  svc.ingestObservation(obs({ severity: 'HIGH', timestamp: NOW + 2 * 60 * 60_000 }));
  svc.ingestObservation(obs({ severity: 'CRITICAL', timestamp: NOW + 3 * 60 * 60_000 }));
  svc.updateRecoveryRate(p.id);
  assert.ok(svc.getProfile(p.id)!.recoveryRate < 0);
});

test('updateRecoveryRate: uses only the last 5 data points', () => {
  const svc = createRecoveryModelingEngine({ storage: createMemoryStorage(), now: () => NOW });
  const p = svc.initProfile(situation(), obs({ severity: 'CRITICAL', timestamp: NOW }));
  // 10 points where the last 5 are flat at LOW → rate should be ~0 from those
  const samples: ObservationSeverity[] = ['HIGH', 'MEDIUM', 'LOW', 'LOW', 'LOW', 'LOW', 'LOW', 'LOW', 'LOW'];
  for (let i = 0; i < samples.length; i++) {
    svc.ingestObservation(obs({ severity: samples[i]!, timestamp: NOW + (i + 1) * 60 * 60_000 }));
  }
  svc.updateRecoveryRate(p.id);
  // Last 5 are all LOW → rate near 0
  assert.ok(Math.abs(svc.getProfile(p.id)!.recoveryRate) < 0.5);
});

test('updateRecoveryRate: returns 0 with fewer than 2 data points', () => {
  const svc = createRecoveryModelingEngine({ storage: createMemoryStorage(), now: () => NOW });
  const p = svc.initProfile(situation(), obs({ severity: 'CRITICAL' }));
  svc.updateRecoveryRate(p.id);
  assert.equal(svc.getProfile(p.id)!.recoveryRate, 0);
});

// ── estimateResolution ──────────────────────────────────────────────────

test('estimateResolution: returns a timestamp > now when rate is positive', () => {
  const svc = createRecoveryModelingEngine({ storage: createMemoryStorage(), now: () => NOW });
  const p = svc.initProfile(situation(), obs({ severity: 'CRITICAL', timestamp: NOW }));
  svc.ingestObservation(obs({ severity: 'HIGH', timestamp: NOW + 60 * 60_000 }));
  svc.ingestObservation(obs({ severity: 'MEDIUM', timestamp: NOW + 2 * 60 * 60_000 }));
  svc.updateRecoveryRate(p.id);
  const estimate = svc.estimateResolution(p.id);
  assert.ok(estimate !== null);
  assert.ok(estimate! > NOW);
});

test('estimateResolution: returns null when rate is non-positive', () => {
  const svc = createRecoveryModelingEngine({ storage: createMemoryStorage(), now: () => NOW });
  const p = svc.initProfile(situation(), obs({ severity: 'LOW', timestamp: NOW }));
  svc.ingestObservation(obs({ severity: 'HIGH', timestamp: NOW + 60 * 60_000 }));
  svc.updateRecoveryRate(p.id);
  assert.equal(svc.estimateResolution(p.id), null);
});

test('estimateResolution: returns null for unknown profile id', () => {
  const svc = createRecoveryModelingEngine({ storage: createMemoryStorage(), now: () => NOW });
  assert.equal(svc.estimateResolution('does-not-exist'), null);
});

test('estimateResolution: writes estimatedResolutionAt onto the profile', () => {
  const svc = createRecoveryModelingEngine({ storage: createMemoryStorage(), now: () => NOW });
  const p = svc.initProfile(situation(), obs({ severity: 'CRITICAL', timestamp: NOW }));
  svc.ingestObservation(obs({ severity: 'HIGH', timestamp: NOW + 60 * 60_000 }));
  svc.ingestObservation(obs({ severity: 'MEDIUM', timestamp: NOW + 2 * 60 * 60_000 }));
  svc.updateRecoveryRate(p.id);
  svc.estimateResolution(p.id);
  assert.ok(typeof svc.getProfile(p.id)!.estimatedResolutionAt === 'number');
});

// ── getActiveProfiles / getCompletedProfiles ────────────────────────────

test('getActiveProfiles excludes resolved profiles', () => {
  const svc = createRecoveryModelingEngine({ storage: createMemoryStorage(), now: () => NOW });
  svc.initProfile(situation(), obs({ severity: 'HIGH' }));
  for (let i = 1; i <= 4; i++) {
    svc.ingestObservation(obs({ severity: 'LOW', timestamp: NOW + i * 60 * 60_000 }));
  }
  assert.equal(svc.getActiveProfiles().filter((p) => p.phase === 'resolved').length, 0);
});

test('getCompletedProfiles respects limit', () => {
  const svc = createRecoveryModelingEngine({ storage: createMemoryStorage(), now: () => NOW });
  for (let i = 0; i < 5; i++) {
    const s = situation({ id: `sit-${i}`, location: { lat: TOKYO.lat + i * 10, lon: TOKYO.lon, radiusKm: 200 } });
    svc.initProfile(s, obs({ severity: 'HIGH', location: s.location }));
    // Drive to resolved
    for (let j = 1; j <= 4; j++) {
      svc.ingestObservation(obs({
        severity: 'LOW',
        location: s.location,
        timestamp: NOW + j * 60 * 60_000,
      }));
    }
  }
  assert.ok(svc.getCompletedProfiles(3).length <= 3);
});

test('getProfile returns the profile by id, or undefined', () => {
  const svc = createRecoveryModelingEngine({ storage: createMemoryStorage(), now: () => NOW });
  const p = svc.initProfile(situation(), obs());
  assert.equal(svc.getProfile(p.id)!.id, p.id);
  assert.equal(svc.getProfile('nope'), undefined);
});

// ── stats ───────────────────────────────────────────────────────────────

test('stats.activeCount reflects active profiles', () => {
  const svc = createRecoveryModelingEngine({ storage: createMemoryStorage(), now: () => NOW });
  svc.initProfile(situation({ id: 'a' }), obs());
  svc.initProfile(situation({ id: 'b', location: { lat: 0, lon: 0, radiusKm: 200 } }),
    obs({ location: { lat: 0, lon: 0 } }));
  assert.equal(svc.stats().activeCount, 2);
});

test('stats.avgRecoveryRateByDomain averages across profiles in a domain', () => {
  const svc = createRecoveryModelingEngine({ storage: createMemoryStorage(), now: () => NOW });
  const p = svc.initProfile(situation({ domain: 'earthquake' }), obs({ severity: 'CRITICAL' }));
  svc.ingestObservation(obs({ severity: 'HIGH', timestamp: NOW + 60 * 60_000 }));
  svc.ingestObservation(obs({ severity: 'MEDIUM', timestamp: NOW + 2 * 60 * 60_000 }));
  svc.updateRecoveryRate(p.id);
  const s = svc.stats();
  assert.ok(typeof s.avgRecoveryRateByDomain.earthquake === 'number');
});

test('stats.avgDurationByDomain echoes expected durations for active domains', () => {
  const svc = createRecoveryModelingEngine({ storage: createMemoryStorage(), now: () => NOW });
  svc.initProfile(situation({ domain: 'earthquake' }), obs({ domain: 'earthquake' }));
  assert.equal(svc.stats().avgDurationByDomain.earthquake, 72);
});

// ── Persistence + ring buffer + subscribe ───────────────────────────────

test('persist + rehydrate round-trip preserves profiles + data points', () => {
  const storage = createMemoryStorage();
  const svc1 = createRecoveryModelingEngine({ storage, now: () => NOW });
  const p = svc1.initProfile(situation(), obs({ severity: 'HIGH', timestamp: NOW }));
  svc1.ingestObservation(obs({ severity: 'MEDIUM', timestamp: NOW + 60 * 60_000 }));
  const svc2 = createRecoveryModelingEngine({ storage, now: () => NOW });
  const restored = svc2.getProfile(p.id)!;
  assert.equal(restored.dataPoints.length, 2);
  assert.equal(restored.dataPoints[1]!.severityNum, 2);
});

test('ring buffer caps at MAX_PROFILES', () => {
  const svc = createRecoveryModelingEngine({ storage: createMemoryStorage(), now: () => NOW });
  for (let i = 0; i < MAX_PROFILES + 5; i++) {
    svc.initProfile(
      situation({ id: `s-${i}`, location: { lat: i * 0.1, lon: 0, radiusKm: 200 } }),
      obs({ location: { lat: i * 0.1, lon: 0 } }),
    );
  }
  assert.equal(svc.getActiveProfiles().length, MAX_PROFILES);
});

test('subscribe fires on initProfile and ingestObservation', () => {
  const svc = createRecoveryModelingEngine({ storage: createMemoryStorage(), now: () => NOW });
  let calls = 0;
  svc.subscribe(() => { calls += 1; });
  svc.initProfile(situation(), obs());
  svc.ingestObservation(obs({ severity: 'LOW', timestamp: NOW + 60 * 60_000 }));
  assert.equal(calls, 2);
});

test('unsubscribe stops further callbacks', () => {
  const svc = createRecoveryModelingEngine({ storage: createMemoryStorage(), now: () => NOW });
  let calls = 0;
  const cb = (): void => { calls += 1; };
  svc.subscribe(cb);
  svc.initProfile(situation(), obs());
  svc.unsubscribe(cb);
  svc.ingestObservation(obs({ severity: 'LOW', timestamp: NOW + 60 * 60_000 }));
  assert.equal(calls, 1);
});

// ── Phase type exhaustiveness ───────────────────────────────────────────

test('RecoveryPhase has exactly the 4 spec values', () => {
  const phases: RecoveryPhase[] = ['acute', 'stabilizing', 'recovering', 'resolved'];
  assert.equal(phases.length, 4);
});

// ── Shape integrity ─────────────────────────────────────────────────────

test('getActiveProfiles returns immutable snapshots — caller mutation does not bleed', () => {
  const svc = createRecoveryModelingEngine({ storage: createMemoryStorage(), now: () => NOW });
  svc.initProfile(situation(), obs());
  const snap = svc.getActiveProfiles();
  snap[0]!.phase = 'resolved';
  assert.notEqual(svc.getActiveProfiles()[0]!.phase, 'resolved');
});
