import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createLensContextService,
  STORAGE_KEY,
  DEFAULT_FOCUS_TIME_WINDOW_MS,
} from '../../src/services/intelligence/lens-context.ts';
import type { Situation } from '../../src/services/intelligence/situation-store-v2.ts';
import type { ObservationEvent } from '../../src/types/intelligence.ts';

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

const NOW = 1_745_000_000_000;
const TOKYO = { lat: 35.68, lon: 139.69 };

function makeSituation(overrides: Partial<Situation> = {}): Situation {
  return {
    id: 'sit-1',
    name: 'M6.2 near Tokyo',
    domain: 'earthquake',
    relatedDomains: ['tsunami'],
    severity: 'high',
    status: 'active',
    summary: 'Strong shaking',
    observations: [],
    edges: [],
    entityIds: ['JP'],
    confidence: 0.8,
    startedAt: new Date(NOW - 5 * 60_000),
    updatedAt: new Date(NOW - 60_000),
    location: { lat: TOKYO.lat, lon: TOKYO.lon, radiusKm: 200 },
    tags: ['earthquake'],
    ...overrides,
  };
}

function makeObservation(overrides: Partial<ObservationEvent> = {}): ObservationEvent {
  return {
    id: 'ev-1',
    sourceId: 'usgs-earthquake',
    domain: 'earthquake',
    timestamp: NOW - 10 * 60_000,
    location: { lat: TOKYO.lat, lon: TOKYO.lon, radiusKm: 10 },
    severity: 'HIGH',
    title: 'obs',
    raw: {},
    entityIds: ['JP'],
    tags: ['earthquake'],
    ...overrides,
  };
}

function makeService(situations: Situation[] = []) {
  const storage = createMemoryStorage();
  const svc = createLensContextService({
    storage,
    lookupSituation: (id) => situations.find((s) => s.id === id),
    now: () => NOW,
  });
  return { svc, storage };
}

// ── Defaults / constants ──────────────────────────────────────────────────

test('STORAGE_KEY is "wm-lens-context"', () => {
  assert.equal(STORAGE_KEY, 'wm-lens-context');
});

test('DEFAULT_FOCUS_TIME_WINDOW_MS is 6 hours', () => {
  assert.equal(DEFAULT_FOCUS_TIME_WINDOW_MS, 6 * 60 * 60_000);
});

test('default context: activeSituationId=null, focusDomains=[], isPinned=false', () => {
  const { svc } = makeService();
  const ctx = svc.getContext();
  assert.equal(ctx.activeSituationId, null);
  assert.equal(ctx.activeSituation, null);
  assert.deepEqual(ctx.focusDomains, []);
  assert.equal(ctx.focusLocation, null);
  assert.equal(ctx.isPinned, false);
});

test('default focusTimeWindowMs is the 6h constant', () => {
  const { svc } = makeService();
  assert.equal(svc.getContext().focusTimeWindowMs, DEFAULT_FOCUS_TIME_WINDOW_MS);
});

// ── setActiveSituation ───────────────────────────────────────────────────

test('setActiveSituation populates focusDomains from situation.domain + relatedDomains', () => {
  const { svc } = makeService([makeSituation()]);
  svc.setActiveSituation('sit-1');
  const ctx = svc.getContext();
  assert.equal(ctx.activeSituationId, 'sit-1');
  assert.deepEqual([...ctx.focusDomains].sort(), ['earthquake', 'tsunami']);
});

test('setActiveSituation populates focusLocation from situation.location', () => {
  const { svc } = makeService([makeSituation()]);
  svc.setActiveSituation('sit-1');
  const ctx = svc.getContext();
  assert.deepEqual(ctx.focusLocation, { lat: TOKYO.lat, lon: TOKYO.lon, radiusKm: 200 });
});

test('setActiveSituation populates activeSituation snapshot', () => {
  const { svc } = makeService([makeSituation()]);
  svc.setActiveSituation('sit-1');
  assert.equal(svc.getContext().activeSituation?.name, 'M6.2 near Tokyo');
});

test('setActiveSituation(null) clears all focus fields', () => {
  const { svc } = makeService([makeSituation()]);
  svc.setActiveSituation('sit-1');
  svc.setActiveSituation(null);
  const ctx = svc.getContext();
  assert.equal(ctx.activeSituationId, null);
  assert.deepEqual(ctx.focusDomains, []);
  assert.equal(ctx.focusLocation, null);
});

test('setActiveSituation with unknown id leaves context unchanged', () => {
  const { svc } = makeService([makeSituation()]);
  svc.setActiveSituation('does-not-exist');
  assert.equal(svc.getContext().activeSituationId, null);
});

test('setActiveSituation handles situation with no location (focusLocation stays null)', () => {
  const { svc } = makeService([makeSituation({ location: undefined })]);
  svc.setActiveSituation('sit-1');
  assert.equal(svc.getContext().focusLocation, null);
});

// ── pin / unpin ──────────────────────────────────────────────────────────

test('pin() flips isPinned=true', () => {
  const { svc } = makeService();
  svc.pin();
  assert.equal(svc.getContext().isPinned, true);
});

test('unpin() flips isPinned=false', () => {
  const { svc } = makeService();
  svc.pin();
  svc.unpin();
  assert.equal(svc.getContext().isPinned, false);
});

test('setActiveSituation is a no-op when pinned', () => {
  const { svc } = makeService([makeSituation()]);
  svc.pin();
  svc.setActiveSituation('sit-1');
  assert.equal(svc.getContext().activeSituationId, null);
});

// ── isRelevantDomain / isRelevant ────────────────────────────────────────

test('isRelevantDomain returns true for any domain when no lens active', () => {
  const { svc } = makeService();
  assert.equal(svc.isRelevantDomain('cyber'), true);
});

test('isRelevantDomain returns true for in-focus domain', () => {
  const { svc } = makeService([makeSituation()]);
  svc.setActiveSituation('sit-1');
  assert.equal(svc.isRelevantDomain('earthquake'), true);
  assert.equal(svc.isRelevantDomain('tsunami'), true);
});

test('isRelevantDomain returns false for out-of-focus domain', () => {
  const { svc } = makeService([makeSituation()]);
  svc.setActiveSituation('sit-1');
  assert.equal(svc.isRelevantDomain('cyber'), false);
});

test('isRelevant matches an observation in domain + radius + time window', () => {
  const { svc } = makeService([makeSituation()]);
  svc.setActiveSituation('sit-1');
  assert.equal(svc.isRelevant(makeObservation()), true);
});

test('isRelevant rejects an observation outside the situation domain', () => {
  const { svc } = makeService([makeSituation()]);
  svc.setActiveSituation('sit-1');
  assert.equal(svc.isRelevant(makeObservation({ domain: 'cyber' })), false);
});

test('isRelevant rejects an observation outside the focus radius', () => {
  const { svc } = makeService([makeSituation()]);
  svc.setActiveSituation('sit-1');
  assert.equal(svc.isRelevant(makeObservation({ location: { lat: 0, lon: 0 } })), false);
});

test('isRelevant rejects an observation older than focusTimeWindowMs', () => {
  const { svc } = makeService([makeSituation()]);
  svc.setActiveSituation('sit-1');
  const stale = makeObservation({ timestamp: NOW - 7 * 60 * 60_000 });
  assert.equal(svc.isRelevant(stale), false);
});

test('isRelevant returns true for everything when no lens active', () => {
  const { svc } = makeService();
  assert.equal(svc.isRelevant(makeObservation({ domain: 'cyber' })), true);
});

// ── filterObservations ───────────────────────────────────────────────────

test('filterObservations narrows array to relevant items', () => {
  const { svc } = makeService([makeSituation()]);
  svc.setActiveSituation('sit-1');
  const obs = [
    makeObservation({ id: 'a', domain: 'earthquake' }),
    makeObservation({ id: 'b', domain: 'cyber' }),
    makeObservation({ id: 'c', domain: 'tsunami', location: TOKYO }),
  ];
  const filtered = svc.filterObservations(obs);
  assert.deepEqual(filtered.map((o) => o.id).sort(), ['a', 'c']);
});

test('filterObservations is identity when no lens active', () => {
  const { svc } = makeService();
  const obs = [makeObservation({ id: 'a', domain: 'earthquake' }), makeObservation({ id: 'b', domain: 'cyber' })];
  assert.equal(svc.filterObservations(obs).length, 2);
});

// ── subscribe ────────────────────────────────────────────────────────────

test('subscribe fires on setActiveSituation', () => {
  const { svc } = makeService([makeSituation()]);
  let calls = 0;
  svc.subscribe(() => { calls += 1; });
  svc.setActiveSituation('sit-1');
  svc.setActiveSituation(null);
  assert.equal(calls, 2);
});

test('subscribe fires on pin/unpin', () => {
  const { svc } = makeService();
  let calls = 0;
  svc.subscribe(() => { calls += 1; });
  svc.pin();
  svc.unpin();
  assert.equal(calls, 2);
});

test('subscribe returns unsubscribe function', () => {
  const { svc } = makeService([makeSituation()]);
  let calls = 0;
  const off = svc.subscribe(() => { calls += 1; });
  svc.setActiveSituation('sit-1');
  off();
  svc.setActiveSituation(null);
  assert.equal(calls, 1);
});

// ── getSituationSummaryHtml ──────────────────────────────────────────────

test('getSituationSummaryHtml returns empty string when no situation active', () => {
  const { svc } = makeService();
  assert.equal(svc.getSituationSummaryHtml(), '');
});

test('getSituationSummaryHtml is non-empty and includes situation name when active', () => {
  const { svc } = makeService([makeSituation()]);
  svc.setActiveSituation('sit-1');
  const html = svc.getSituationSummaryHtml();
  assert.ok(html.length > 0);
  assert.ok(html.includes('M6.2 near Tokyo'));
});

test('getSituationSummaryHtml escapes situation names with HTML chars', () => {
  const { svc } = makeService([makeSituation({ name: '<script>alert(1)</script>' })]);
  svc.setActiveSituation('sit-1');
  const html = svc.getSituationSummaryHtml();
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(html.includes('&lt;script&gt;'));
});

// ── persistence ──────────────────────────────────────────────────────────

test('persists activeSituationId + isPinned to sessionStorage at STORAGE_KEY', () => {
  const { svc, storage } = makeService([makeSituation()]);
  svc.setActiveSituation('sit-1');
  svc.pin();
  const raw = storage.getItem(STORAGE_KEY);
  assert.ok(raw);
  const parsed = JSON.parse(raw!);
  assert.equal(parsed.activeSituationId, 'sit-1');
  assert.equal(parsed.isPinned, true);
});

test('rehydrates active situation from sessionStorage on construction', () => {
  const storage = createMemoryStorage();
  storage.setItem(STORAGE_KEY, JSON.stringify({ activeSituationId: 'sit-1', isPinned: true }));
  const svc = createLensContextService({
    storage,
    lookupSituation: () => makeSituation(),
    now: () => NOW,
  });
  const ctx = svc.getContext();
  assert.equal(ctx.activeSituationId, 'sit-1');
  assert.equal(ctx.isPinned, true);
  assert.deepEqual([...ctx.focusDomains].sort(), ['earthquake', 'tsunami']);
});
