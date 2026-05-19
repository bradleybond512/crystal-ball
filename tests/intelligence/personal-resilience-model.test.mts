import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ALERT_COUNT_CEILING,
  DEFAULT_USER_ID,
  MAX_PROFILES,
  PERSONAL_RESILIENCE_KEY,
  PersonalResilienceModel,
  computeExposure,
  preparednessLevelFor,
  type AlertHistoryEntry,
  type ResilienceProfile,
  type TravelWindow,
} from '@/services/intelligence/personal-resilience-model';

class MemoryStorage {
  private map = new Map<string, string>();
  getItem(k: string): string | null { return this.map.get(k) ?? null; }
  setItem(k: string, v: string): void { this.map.set(k, v); }
  removeItem(k: string): void { this.map.delete(k); }
  raw(): Map<string, string> { return this.map; }
}

const T0 = 1_750_000_000_000;

function fresh(storage: MemoryStorage = new MemoryStorage()): PersonalResilienceModel {
  return PersonalResilienceModel.resetForTests(storage);
}

function alerts(domain: string, n: number, severity = 0.5): AlertHistoryEntry[] {
  return Array.from({ length: n }, () => ({ domain, severity }));
}

function window_(region: string, start = T0, end = T0 + 86_400_000): TravelWindow {
  return { region, startMs: start, endMs: end };
}

// ── preparednessLevelFor ────────────────────────────────────────────────

test('preparednessLevelFor: 0 → low', () => {
  assert.equal(preparednessLevelFor(0), 'low');
});

test('preparednessLevelFor: 0.39 → low', () => {
  assert.equal(preparednessLevelFor(0.39), 'low');
});

test('preparednessLevelFor: 0.4 boundary → medium', () => {
  assert.equal(preparednessLevelFor(0.4), 'medium');
});

test('preparednessLevelFor: 0.69 → medium', () => {
  assert.equal(preparednessLevelFor(0.69), 'medium');
});

test('preparednessLevelFor: 0.7 boundary → high', () => {
  assert.equal(preparednessLevelFor(0.7), 'high');
});

test('preparednessLevelFor: 1 → high', () => {
  assert.equal(preparednessLevelFor(1), 'high');
});

test('preparednessLevelFor: NaN clamps to low', () => {
  assert.equal(preparednessLevelFor(Number.NaN), 'low');
});

// ── computeExposure ─────────────────────────────────────────────────────

test('computeExposure: 0 alerts, no travel, no places → 0.2 (domain-interest floor)', () => {
  assert.equal(computeExposure(0, [], []), 0.2);
});

test('computeExposure: 25 alerts (half-ceiling), nothing else → 0.2 + 0.2', () => {
  // 25/50 = 0.5 → 0.5*0.4 = 0.2; plus domainInterest 0.2 = 0.4 total.
  assert.equal(computeExposure(25, [], []), 0.4);
});

test('computeExposure: 50 alerts at ceiling → 0.4 alert + 0.2 interest = 0.6', () => {
  assert.equal(computeExposure(50, [], []), 0.6);
});

test('computeExposure: 100 alerts clamped at ceiling → same as 50', () => {
  assert.equal(computeExposure(100, [], []), 0.6);
});

test('computeExposure: full region overlap, no alerts → 0.4 overlap + 0.2 interest = 0.6', () => {
  const places = ['Tokyo'];
  const wins = [window_('Tokyo')];
  assert.equal(computeExposure(0, places, wins), 0.6);
});

test('computeExposure: half-overlap (1 of 2 places travelled) → 0.5*0.4 + 0.2 = 0.4', () => {
  const places = ['Tokyo', 'Berlin'];
  const wins = [window_('Tokyo')];
  assert.equal(computeExposure(0, places, wins), 0.4);
});

test('computeExposure: travel to non-saved place contributes 0', () => {
  const places = ['Tokyo'];
  const wins = [window_('Paris')];
  assert.equal(computeExposure(0, places, wins), 0.2);
});

test('computeExposure: no saved places makes regionOverlap 0', () => {
  assert.equal(computeExposure(0, [], [window_('Tokyo')]), 0.2);
});

test('computeExposure: full formula — 50 alerts + full overlap → clamped 1.0', () => {
  const places = ['Tokyo'];
  const wins = [window_('Tokyo')];
  // 0.4 + 0.4 + 0.2 = 1.0
  assert.equal(computeExposure(50, places, wins), 1);
});

test('computeExposure: clamp protects against >1', () => {
  // 100 alerts (clamped to 1.0 alert-share), 5 travel windows to single saved place
  const places = ['Tokyo'];
  const wins = [window_('Tokyo'), window_('Tokyo'), window_('Tokyo'), window_('Tokyo'), window_('Tokyo')];
  assert.equal(computeExposure(100, places, wins), 1);
});

test('computeExposure: negative alerts treated as 0', () => {
  assert.equal(computeExposure(-5, [], []), 0.2);
});

test('computeExposure: fractional alert count floored', () => {
  // 25.9 → floored to 25 → 0.5 * 0.4 = 0.2 alert share
  assert.equal(computeExposure(25.9, [], []), 0.4);
});

test('ALERT_COUNT_CEILING is exported as 50', () => {
  assert.equal(ALERT_COUNT_CEILING, 50);
});

// ── singleton ──────────────────────────────────────────────────────────

test('getInstance: returns the same instance across calls', () => {
  PersonalResilienceModel.resetForTests(null);
  const a = PersonalResilienceModel.getInstance();
  const b = PersonalResilienceModel.getInstance();
  assert.equal(a, b);
});

test('resetForTests: drops the singleton', () => {
  const a = PersonalResilienceModel.resetForTests(new MemoryStorage());
  const b = PersonalResilienceModel.resetForTests(new MemoryStorage());
  assert.notEqual(a, b);
});

test('default user id is "default"', () => {
  assert.equal(DEFAULT_USER_ID, 'default');
});

// ── updateProfile: basic shape ─────────────────────────────────────────

test('updateProfile: returns a profile keyed to DEFAULT_USER_ID', () => {
  const m = fresh();
  const p = m.updateProfile([], [], [], [], T0);
  assert.equal(p.userId, DEFAULT_USER_ID);
});

test('updateProfile: sets lastUpdated from the `now` argument', () => {
  const m = fresh();
  const p = m.updateProfile([], [], [], [], T0);
  assert.equal(p.lastUpdated, T0);
});

test('updateProfile: no domains → resilience 1.0 (best case)', () => {
  const m = fresh();
  const p = m.updateProfile(['Tokyo'], [window_('Tokyo')], [], alerts('weather', 30), T0);
  assert.equal(p.overallResilienceScore, 1);
  assert.equal(p.preparednessLevel, 'high');
  assert.deepEqual(p.riskExposure, []);
  assert.deepEqual(p.topRisks, []);
  assert.deepEqual(p.recommendations, []);
});

test('updateProfile: single domain produces a single exposure row', () => {
  const m = fresh();
  const p = m.updateProfile(['Tokyo'], [window_('Tokyo')], ['weather'], [], T0);
  assert.equal(p.riskExposure.length, 1);
  assert.equal(p.riskExposure[0]?.domain, 'weather');
});

test('updateProfile: alertsReceived counts only matching-domain alerts', () => {
  const m = fresh();
  const hist: AlertHistoryEntry[] = [
    ...alerts('weather', 7),
    ...alerts('cyber', 3),
  ];
  const p = m.updateProfile([], [], ['weather', 'cyber'], hist, T0);
  const wx = p.riskExposure.find((e) => e.domain === 'weather');
  const cy = p.riskExposure.find((e) => e.domain === 'cyber');
  assert.equal(wx?.alertsReceived, 7);
  assert.equal(cy?.alertsReceived, 3);
});

test('updateProfile: relevantRegions equals deduped savedPlaces', () => {
  const m = fresh();
  const p = m.updateProfile(['Tokyo', 'Berlin', 'Tokyo'], [], ['weather'], [], T0);
  assert.deepEqual(p.riskExposure[0]?.relevantRegions, ['Tokyo', 'Berlin']);
});

test('updateProfile: duplicate domain inputs collapse to one row', () => {
  const m = fresh();
  const p = m.updateProfile([], [], ['weather', 'weather'], [], T0);
  assert.equal(p.riskExposure.length, 1);
});

test('updateProfile: empty string places/domains are filtered', () => {
  const m = fresh();
  const p = m.updateProfile(['', 'Tokyo'], [], ['', 'weather'], [], T0);
  assert.equal(p.riskExposure.length, 1);
  assert.deepEqual(p.riskExposure[0]?.relevantRegions, ['Tokyo']);
});

// ── updateProfile: scoring ─────────────────────────────────────────────

test('updateProfile: overallResilience = 1 − mean(exposure)', () => {
  const m = fresh();
  // savedPlaces/travelWindows are shared across all opted-in domains,
  // so both weather and cyber get the same regionOverlap of 1.
  //   weather: 0 alerts + 0.4 overlap + 0.2 interest = 0.6
  //   cyber:   25 alerts (0.2) + 0.4 overlap + 0.2 interest = 0.8
  // mean = 0.7 → resilience 0.3 → preparedness 'low'.
  const p = m.updateProfile(
    ['Tokyo'],
    [window_('Tokyo')],
    ['weather', 'cyber'],
    alerts('cyber', 25),
    T0,
  );
  assert.equal(p.overallResilienceScore, 0.3);
  assert.equal(p.preparednessLevel, 'low');
});

test('updateProfile: preparedness "high" when exposure stays low across domains', () => {
  const m = fresh();
  // domainInterest floor of 0.2 keeps exposure non-zero, so use enough
  // domains that mean exposure stays at 0.2 → resilience 0.8.
  const p = m.updateProfile([], [], ['weather', 'cyber', 'finance'], [], T0);
  assert.equal(p.overallResilienceScore, 0.8);
  assert.equal(p.preparednessLevel, 'high');
});

test('updateProfile: preparedness "low" when every domain is maxed', () => {
  const m = fresh();
  const p = m.updateProfile(
    ['Tokyo'],
    [window_('Tokyo')],
    ['weather'],
    alerts('weather', 100),
    T0,
  );
  assert.equal(p.overallResilienceScore, 0);
  assert.equal(p.preparednessLevel, 'low');
});

test('updateProfile: topRisks sorted by exposureLevel desc, capped at 3', () => {
  const m = fresh();
  const p = m.updateProfile(
    ['Tokyo'],
    [window_('Tokyo')],
    ['a', 'b', 'c', 'd'],
    [...alerts('a', 50), ...alerts('b', 25), ...alerts('c', 10)],
    T0,
  );
  assert.equal(p.topRisks.length, 3);
  assert.equal(p.topRisks[0], 'a');
  assert.equal(p.topRisks[1], 'b');
  assert.equal(p.topRisks[2], 'c');
});

test('updateProfile: topRisks shorter than 3 when fewer domains exist', () => {
  const m = fresh();
  const p = m.updateProfile([], [], ['solo'], [], T0);
  assert.equal(p.topRisks.length, 1);
});

test('updateProfile: recommendations align with topRisks order', () => {
  const m = fresh();
  const p = m.updateProfile(
    [],
    [],
    ['a', 'b'],
    [...alerts('a', 50), ...alerts('b', 10)],
    T0,
  );
  assert.equal(p.recommendations.length, 2);
  assert.ok(p.recommendations[0]?.includes('a'));
  assert.ok(p.recommendations[1]?.includes('b'));
});

test('updateProfile: recommendation tier mentions "High" when exposure ≥ 0.7', () => {
  const m = fresh();
  const p = m.updateProfile(
    ['Tokyo'],
    [window_('Tokyo')],
    ['weather'],
    alerts('weather', 100),
    T0,
  );
  assert.ok(p.recommendations[0]?.startsWith('High'));
});

test('updateProfile: recommendation tier mentions "Moderate" mid-range', () => {
  const m = fresh();
  // 25 alerts → 0.2 alert share; +0.2 interest = 0.4 exposure.
  const p = m.updateProfile([], [], ['weather'], alerts('weather', 25), T0);
  assert.ok(p.recommendations[0]?.startsWith('Moderate'));
});

test('updateProfile: recommendation tier mentions "Low" when exposure < 0.4', () => {
  const m = fresh();
  // 0 alerts, no overlap → 0.2 exposure (interest floor).
  const p = m.updateProfile([], [], ['weather'], [], T0);
  assert.ok(p.recommendations[0]?.startsWith('Low'));
});

// ── getProfile / getRecommendations ────────────────────────────────────

test('getProfile: undefined before any update', () => {
  const m = fresh();
  assert.equal(m.getProfile(), undefined);
});

test('getProfile: returns the most recent profile after update', () => {
  const m = fresh();
  const p = m.updateProfile([], [], ['weather'], [], T0);
  assert.deepEqual(m.getProfile(), p);
});

test('getRecommendations: empty array before any update', () => {
  const m = fresh();
  assert.deepEqual(m.getRecommendations(), []);
});

test('getRecommendations: top-3 actionable suggestions after update', () => {
  const m = fresh();
  m.updateProfile(
    [],
    [],
    ['a', 'b', 'c', 'd'],
    [...alerts('a', 50), ...alerts('b', 25), ...alerts('c', 10)],
    T0,
  );
  const recs = m.getRecommendations();
  assert.equal(recs.length, 3);
});

// ── storage / hydrate ──────────────────────────────────────────────────

test('persist: writes to storage on update', () => {
  const storage = new MemoryStorage();
  const m = fresh(storage);
  m.updateProfile([], [], ['weather'], [], T0);
  assert.ok(storage.getItem(PERSONAL_RESILIENCE_KEY));
});

test('hydrate: empty storage → no profile', () => {
  const m = fresh(new MemoryStorage());
  assert.equal(m.getProfile(), undefined);
});

test('hydrate: valid stored profile re-loads after reset', () => {
  const storage = new MemoryStorage();
  const m1 = fresh(storage);
  m1.updateProfile(['Tokyo'], [], ['weather'], alerts('weather', 5), T0);
  const m2 = PersonalResilienceModel.resetForTests(storage);
  const reloaded = m2.getProfile();
  assert.equal(reloaded?.userId, DEFAULT_USER_ID);
  assert.equal(reloaded?.lastUpdated, T0);
});

test('hydrate: malformed storage yields empty model (no throw)', () => {
  const storage = new MemoryStorage();
  storage.setItem(PERSONAL_RESILIENCE_KEY, '{not json');
  const m = PersonalResilienceModel.resetForTests(storage);
  assert.equal(m.getProfile(), undefined);
});

test('hydrate: rejects entries with bad preparednessLevel', () => {
  const storage = new MemoryStorage();
  storage.setItem(PERSONAL_RESILIENCE_KEY, JSON.stringify([{
    userId: 'default',
    overallResilienceScore: 0.5,
    riskExposure: [],
    preparednessLevel: 'bogus',
    topRisks: [],
    recommendations: [],
    lastUpdated: T0,
  }]));
  const m = PersonalResilienceModel.resetForTests(storage);
  assert.equal(m.getProfile(), undefined);
});

test('null storage: getInstance with no localStorage does not throw', () => {
  const m = PersonalResilienceModel.resetForTests(null);
  m.updateProfile([], [], ['weather'], [], T0);
  assert.equal(m.getProfile()?.userId, DEFAULT_USER_ID);
});

test('clear: drops the profile and persists empty state', () => {
  const storage = new MemoryStorage();
  const m = fresh(storage);
  m.updateProfile([], [], ['weather'], [], T0);
  m.clear();
  assert.equal(m.getProfile(), undefined);
  assert.equal(storage.getItem(PERSONAL_RESILIENCE_KEY), '[]');
});

test('updateProfile twice: overwrites the same user slot', () => {
  const m = fresh();
  m.updateProfile([], [], ['weather'], [], T0);
  m.updateProfile([], [], ['cyber'], [], T0 + 1000);
  assert.equal(m.getAllProfiles().length, 1);
  assert.equal(m.getProfile()?.riskExposure[0]?.domain, 'cyber');
});

test('MAX_PROFILES is exported and equals 10', () => {
  assert.equal(MAX_PROFILES, 10);
});

test('PERSONAL_RESILIENCE_KEY is wm-personal-resilience', () => {
  assert.equal(PERSONAL_RESILIENCE_KEY, 'wm-personal-resilience');
});

// ── shape integrity ────────────────────────────────────────────────────

test('riskExposure rows are clamped to [0,1]', () => {
  const m = fresh();
  const p = m.updateProfile(
    ['Tokyo'],
    [window_('Tokyo'), window_('Tokyo')],
    ['weather'],
    alerts('weather', 200),
    T0,
  );
  const e = p.riskExposure[0] as Exclude<ResilienceProfile['riskExposure'][number], undefined>;
  assert.ok(e.exposureLevel >= 0 && e.exposureLevel <= 1);
});

test('updateProfile result is JSON-serializable', () => {
  const m = fresh();
  const p = m.updateProfile(['Tokyo'], [window_('Tokyo')], ['weather'], alerts('weather', 5), T0);
  const round = JSON.parse(JSON.stringify(p)) as ResilienceProfile;
  assert.deepEqual(round, p);
});
