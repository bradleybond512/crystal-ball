/**
 * Regression tests for the situation-engine feedback loop (review H10/H15).
 *
 * Measured on a live installation during a flood event: 286 of 289 critical
 * alerts were `correlation` echoes; one Flood Warning was re-emitted 71 times,
 * each labelled "civil unrest"; a persisting compound threat minted a new alert
 * every 5 minutes. Each test below pins one link of that chain.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

// Minimal globals so modules that touch window/localStorage at import are inert.
(globalThis as Record<string, unknown>).window = globalThis;
const store = new Map<string, string>();
(globalThis as Record<string, unknown>).localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => { store.set(k, v); },
  removeItem: (k: string) => { store.delete(k); },
  clear: () => { store.clear(); },
};

const { isEngineInput } = await import('../situation-feed.ts');
const { domainHintForAlertSource } = await import('../situation-engine.ts');
const { signalDomainOf, classifyDomain } = await import('../situation-correlator.ts');
const { compoundEpisodeId } = await import('../compound-alert-bridge.ts');
const { UnifiedAlertStore, isPrePurgeLoopEcho } = await import('../unified-alerts.ts');
type UnifiedAlert = import('../unified-alerts.ts').UnifiedAlert;
type CorrelationSignalCore = import('../analysis-core.ts').CorrelationSignalCore;

function alert(id: string, source: UnifiedAlert['source'], extra: Partial<UnifiedAlert> = {}): UnifiedAlert {
  return {
    id, source, severity: 'critical', title: 'Flood Warning', body: 'b',
    timestamp: Date.now(), relevanceScore: 0, acknowledged: false, pinned: false, ...extra,
  };
}

function signal(type: CorrelationSignalCore['type'], domainHint?: string): CorrelationSignalCore {
  return {
    id: 's', type, title: 't', description: 'd', confidence: 0.85, timestamp: new Date(),
    data: domainHint === undefined ? {} : { domainHint },
  } as CorrelationSignalCore;
}

// ── Link 1: the engine must not observe its own output ─────────────────────

test('isEngineInput rejects correlation alerts (the engine\'s own output)', () => {
  assert.equal(isEngineInput(alert('sit-1', 'correlation')), false);
});

test('isEngineInput accepts source alerts', () => {
  for (const src of ['nws', 'gdacs', 'earthquake', 'cyber', 'comms-health'] as const) {
    assert.equal(isEngineInput(alert(`x-${src}`, src)), true, src);
  }
});

// ── Link 2: weather must not be classified as civil unrest ──────────────────

test('weather and seismic sources carry a natural_hazard domain hint', () => {
  for (const src of ['nws', 'spc', 'gdacs', 'earthquake', 'volcano', 'tsunami', 'fire']) {
    assert.equal(domainHintForAlertSource(src), 'natural_hazard', src);
  }
});

test('non-weather sources map to their own domains; unknown sources get no hint', () => {
  assert.equal(domainHintForAlertSource('cyber'), 'cyber');
  assert.equal(domainHintForAlertSource('comms-health'), 'infrastructure');
  assert.equal(domainHintForAlertSource('disease'), 'health');
  assert.equal(domainHintForAlertSource('breaking-news'), undefined);
});

test('signalDomainOf honours a valid hint over the placeholder signal type', () => {
  // nws pseudo-signals ride on keyword_spike, which the type map calls civil_unrest.
  assert.equal(classifyDomain('keyword_spike'), 'civil_unrest');
  assert.equal(signalDomainOf(signal('keyword_spike', 'natural_hazard')), 'natural_hazard');
  // gdacs rides on geo_convergence, which the type map calls military.
  assert.equal(signalDomainOf(signal('geo_convergence', 'natural_hazard')), 'natural_hazard');
});

test('signalDomainOf falls back to the type map for absent or invalid hints', () => {
  assert.equal(signalDomainOf(signal('keyword_spike')), 'civil_unrest');
  assert.equal(signalDomainOf(signal('keyword_spike', 'not-a-domain')), 'civil_unrest');
});

// ── Link 3: a persisting compound is one alert, not one per scan ───────────

test('compoundEpisodeId is stable while a compound persists across scans', () => {
  const reg = new Map<string, { start: number; lastSeen: number }>();
  const gap = 15 * 60_000;
  const t0 = 1_000_000;
  const ids = new Set<string>();
  // 49 scans, 5 minutes apart (~4 hours) — the measured 47-alert case.
  for (let i = 0; i < 49; i++) ids.add(compoundEpisodeId('infrastructure-natural_disaster', t0 + i * 5 * 60_000, reg, gap));
  assert.equal(ids.size, 1);
});

test('compoundEpisodeId starts a new episode after the compound clears', () => {
  const reg = new Map<string, { start: number; lastSeen: number }>();
  const gap = 15 * 60_000;
  const a = compoundEpisodeId('k', 0, reg, gap);
  const b = compoundEpisodeId('k', gap + 1, reg, gap);
  assert.notEqual(a, b);
});

test('compoundEpisodeId keeps different domain sets independent', () => {
  const reg = new Map<string, { start: number; lastSeen: number }>();
  assert.notEqual(compoundEpisodeId('a', 0, reg), compoundEpisodeId('b', 0, reg));
});

// ── Link 4: echoes persisted before the fix are purged exactly once ────────

test('isPrePurgeLoopEcho targets unpinned correlation alerts only', () => {
  assert.equal(isPrePurgeLoopEcho({ source: 'correlation', pinned: false }), true);
  assert.equal(isPrePurgeLoopEcho({ source: 'correlation', pinned: true }), false);
  assert.equal(isPrePurgeLoopEcho({ source: 'nws', pinned: false }), false);
});

test('hydration drops pre-fix echoes once, keeping source and pinned alerts', () => {
  store.clear();
  store.set('wm-unified-alerts-v1', JSON.stringify([
    alert('sit-sit-a-33', 'correlation'),
    alert('sit-sit-a-34', 'correlation'),
    alert('pinned-sit', 'correlation', { pinned: true }),
    alert('nws-urn-1', 'nws'),
  ]));
  const s1 = new UnifiedAlertStore();
  assert.deepEqual(s1.getAll().map((a) => a.id).sort(), ['nws-urn-1', 'pinned-sit']);
  assert.equal(store.get('cb-alert-loop-echo-purge-v1'), '1');

  // A second load must NOT purge again: post-fix correlation alerts are legitimate.
  store.set('wm-unified-alerts-v1', JSON.stringify([alert('sit-legit', 'correlation'), alert('nws-urn-2', 'nws')]));
  const s2 = new UnifiedAlertStore();
  assert.deepEqual(s2.getAll().map((a) => a.id).sort(), ['nws-urn-2', 'sit-legit']);
});
