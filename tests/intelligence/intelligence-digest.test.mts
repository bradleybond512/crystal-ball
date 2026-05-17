import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createIntelligenceDigestService,
  STORAGE_KEY,
  MAX_DIGESTS,
  type DigestPeriod,
  type DigestItem,
  type DigestSituation,
  type DigestSignatureMatch,
  type DigestContradiction,
  type DigestFailurePrediction,
} from '../../src/services/intelligence/intelligence-digest.ts';

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

const NOW = new Date('2026-05-17T12:00:00Z').getTime();
const HOUR = 60 * 60_000;

function sit(overrides: Partial<DigestSituation> = {}): DigestSituation {
  return {
    id: overrides.id ?? 'sit-1',
    name: overrides.name ?? 'Test situation',
    domain: overrides.domain ?? 'earthquake',
    severity: overrides.severity ?? 'high',
    summary: overrides.summary ?? 'Active earthquake situation.',
    updatedAt: overrides.updatedAt ?? NOW - 30 * 60_000,
  };
}

// ── Constants ────────────────────────────────────────────────────────────

test('STORAGE_KEY is "wm-intelligence-digest"', () => {
  assert.equal(STORAGE_KEY, 'wm-intelligence-digest');
});

test('MAX_DIGESTS is 90', () => {
  assert.equal(MAX_DIGESTS, 90);
});

// ── generate: empty / no providers ───────────────────────────────────────

test('generate without any providers returns a non-null digest with empty sections', () => {
  const svc = createIntelligenceDigestService({ storage: createMemoryStorage(), now: () => NOW });
  const digest = svc.generate('24h');
  assert.equal(digest.period, '24h');
  assert.equal(digest.totalAlerts, 0);
  assert.equal(digest.criticalCount, 0);
  assert.deepEqual(digest.topRisks, []);
});

test('generate without providers picks a default no-activity headline', () => {
  const svc = createIntelligenceDigestService({ storage: createMemoryStorage(), now: () => NOW });
  const digest = svc.generate('24h');
  assert.match(digest.headline, /no.*active|quiet|stable/i);
});

test('generate sets generatedAt to current clock', () => {
  const svc = createIntelligenceDigestService({ storage: createMemoryStorage(), now: () => NOW });
  const digest = svc.generate('1h');
  assert.equal(digest.generatedAt, NOW);
});

test('generate assigns a unique id', () => {
  const svc = createIntelligenceDigestService({ storage: createMemoryStorage(), now: () => NOW });
  const a = svc.generate('1h');
  const b = svc.generate('1h');
  assert.notEqual(a.id, b.id);
});

// ── Period filtering ────────────────────────────────────────────────────

test('generate filters situations to the period window', () => {
  const situations: DigestSituation[] = [
    sit({ id: 'recent', updatedAt: NOW - 30 * 60_000 }),
    sit({ id: 'old', updatedAt: NOW - 5 * HOUR }),
  ];
  const svc = createIntelligenceDigestService({
    storage: createMemoryStorage(), now: () => NOW,
    situationsProvider: { getRecent: () => situations },
  });
  const oneHour = svc.generate('1h');
  // Only the recent situation should appear
  const ids = oneHour.sections.flatMap((s) => s.items.map((i) => i.situationId));
  assert.ok(ids.includes('recent'));
  assert.ok(!ids.includes('old'));
});

test('24h window captures situations updated up to 24h ago', () => {
  const situations: DigestSituation[] = [
    sit({ id: 'recent', updatedAt: NOW - 30 * 60_000 }),
    sit({ id: 'mid', updatedAt: NOW - 12 * HOUR }),
    sit({ id: 'edge', updatedAt: NOW - 23 * HOUR }),
    sit({ id: 'old', updatedAt: NOW - 30 * HOUR }),
  ];
  const svc = createIntelligenceDigestService({
    storage: createMemoryStorage(), now: () => NOW,
    situationsProvider: { getRecent: () => situations },
  });
  const digest = svc.generate('24h');
  const ids = digest.sections.flatMap((s) => s.items.map((i) => i.situationId));
  assert.ok(ids.includes('recent'));
  assert.ok(ids.includes('mid'));
  assert.ok(ids.includes('edge'));
  assert.ok(!ids.includes('old'));
});

// ── Section composition + totals ────────────────────────────────────────

test('situations section contains the recent situations', () => {
  const situations = [sit({ id: 'a', name: 'Alpha' }), sit({ id: 'b', name: 'Bravo' })];
  const svc = createIntelligenceDigestService({
    storage: createMemoryStorage(), now: () => NOW,
    situationsProvider: { getRecent: () => situations },
  });
  const d = svc.generate('24h');
  const section = d.sections.find((s) => /situation/i.test(s.title));
  assert.ok(section);
  assert.equal(section!.itemCount, 2);
});

test('contradictions section appears when contradictionsProvider returns data', () => {
  const contradictions: DigestContradiction[] = [{
    id: 'c1', conflictType: 'severity-mismatch', domain: 'cyber',
    region: 'asia', severity: 'high', detectedAt: NOW - 30 * 60_000,
    summary: 'Two sources disagree',
  }];
  const svc = createIntelligenceDigestService({
    storage: createMemoryStorage(), now: () => NOW,
    contradictionsProvider: { getOpen: () => contradictions },
  });
  const d = svc.generate('24h');
  assert.ok(d.sections.some((s) => /contradict/i.test(s.title)));
});

test('failure predictions section appears when provider returns high-risk predictions', () => {
  const predictions: DigestFailurePrediction[] = [{
    target: 'usgs', probability: 0.85, predictedAt: NOW - 30 * 60_000,
    summary: 'feed degrading',
  }];
  const svc = createIntelligenceDigestService({
    storage: createMemoryStorage(), now: () => NOW,
    failurePredictionProvider: { getHighRisk: () => predictions },
  });
  const d = svc.generate('24h');
  assert.ok(d.sections.some((s) => /failure|prediction/i.test(s.title)));
});

test('signature matches section appears when provider returns matches', () => {
  const matches: DigestSignatureMatch[] = [{
    signatureId: 's-1', situationId: 'sit-1', confidence: 0.8,
    domain: 'earthquake', matchedAt: NOW - 30 * 60_000,
  }];
  const svc = createIntelligenceDigestService({
    storage: createMemoryStorage(), now: () => NOW,
    signatureProvider: { getActive: () => matches },
  });
  const d = svc.generate('24h');
  assert.ok(d.sections.some((s) => /signature/i.test(s.title)));
});

test('totalAlerts sums itemCount across all sections', () => {
  const situations = [sit({ id: 'a' }), sit({ id: 'b' })];
  const contradictions: DigestContradiction[] = [{
    id: 'c1', conflictType: 'status-conflict', domain: 'maritime',
    region: 'pacific', severity: 'medium', detectedAt: NOW - 30 * 60_000, summary: 's',
  }];
  const svc = createIntelligenceDigestService({
    storage: createMemoryStorage(), now: () => NOW,
    situationsProvider: { getRecent: () => situations },
    contradictionsProvider: { getOpen: () => contradictions },
  });
  const d = svc.generate('24h');
  const sum = d.sections.reduce((acc, s) => acc + s.itemCount, 0);
  assert.equal(d.totalAlerts, sum);
});

test('criticalCount counts items with severity=critical', () => {
  const situations = [
    sit({ id: 'a', severity: 'critical' }),
    sit({ id: 'b', severity: 'high' }),
    sit({ id: 'c', severity: 'critical' }),
  ];
  const svc = createIntelligenceDigestService({
    storage: createMemoryStorage(), now: () => NOW,
    situationsProvider: { getRecent: () => situations },
  });
  const d = svc.generate('24h');
  assert.equal(d.criticalCount, 2);
});

// ── topRisks ─────────────────────────────────────────────────────────────

test('topRisks returns up to 3 highest-severity items', () => {
  const situations = [
    sit({ id: 'low', severity: 'low' }),
    sit({ id: 'medium', severity: 'medium' }),
    sit({ id: 'high1', severity: 'high' }),
    sit({ id: 'crit1', severity: 'critical' }),
    sit({ id: 'crit2', severity: 'critical' }),
  ];
  const svc = createIntelligenceDigestService({
    storage: createMemoryStorage(), now: () => NOW,
    situationsProvider: { getRecent: () => situations },
  });
  const d = svc.generate('24h');
  assert.equal(d.topRisks.length, 3);
  // The two criticals should be in there
  assert.ok(d.topRisks.some((r) => r.situationId === 'crit1'));
  assert.ok(d.topRisks.some((r) => r.situationId === 'crit2'));
});

test('topRisks is empty when no items', () => {
  const svc = createIntelligenceDigestService({ storage: createMemoryStorage(), now: () => NOW });
  const d = svc.generate('24h');
  assert.deepEqual(d.topRisks, []);
});

// ── Civilization pulse ──────────────────────────────────────────────────

test('civilizationPulseScore + pulseLabel come from the pulse provider', () => {
  const svc = createIntelligenceDigestService({
    storage: createMemoryStorage(), now: () => NOW,
    pulseProvider: { getLatest: () => ({ score: 0.42, label: 'elevated' }) },
  });
  const d = svc.generate('1h');
  assert.equal(d.civilizationPulseScore, 0.42);
  assert.equal(d.pulseLabel, 'elevated');
});

test('civilizationPulseScore is null when no pulse provider', () => {
  const svc = createIntelligenceDigestService({ storage: createMemoryStorage(), now: () => NOW });
  const d = svc.generate('1h');
  assert.equal(d.civilizationPulseScore, null);
});

// ── World narrative ─────────────────────────────────────────────────────

test('worldNarrative comes from the narrative provider when present', () => {
  const svc = createIntelligenceDigestService({
    storage: createMemoryStorage(), now: () => NOW,
    narrativeProvider: { getLatest: () => 'The world is on edge tonight.' },
  });
  const d = svc.generate('1h');
  assert.equal(d.worldNarrative, 'The world is on edge tonight.');
});

test('worldNarrative is null when no narrative provider', () => {
  const svc = createIntelligenceDigestService({ storage: createMemoryStorage(), now: () => NOW });
  const d = svc.generate('1h');
  assert.equal(d.worldNarrative, null);
});

// ── Headline composition ────────────────────────────────────────────────

test('headline mentions critical-count when there are critical items', () => {
  const situations = [
    sit({ id: 'a', severity: 'critical', name: 'Big quake' }),
    sit({ id: 'b', severity: 'critical', name: 'Storm' }),
  ];
  const svc = createIntelligenceDigestService({
    storage: createMemoryStorage(), now: () => NOW,
    situationsProvider: { getRecent: () => situations },
  });
  const d = svc.generate('24h');
  assert.match(d.headline, /critical|2/i);
});

test('headline includes the period for context', () => {
  const svc = createIntelligenceDigestService({ storage: createMemoryStorage(), now: () => NOW });
  const d1 = svc.generate('1h');
  const d24 = svc.generate('24h');
  assert.match(d1.headline, /1h|hour/i);
  assert.match(d24.headline, /24h|day|hours/i);
});

// ── getLatestDigest / getHistory ────────────────────────────────────────

test('getLatestDigest returns the most recent generated digest', () => {
  const svc = createIntelligenceDigestService({ storage: createMemoryStorage(), now: () => NOW });
  svc.generate('1h');
  const second = svc.generate('24h');
  assert.equal(svc.getLatestDigest()!.id, second.id);
});

test('getLatestDigest returns undefined before any generate call', () => {
  const svc = createIntelligenceDigestService({ storage: createMemoryStorage(), now: () => NOW });
  assert.equal(svc.getLatestDigest(), undefined);
});

test('getHistory returns digests newest-first, respects limit', () => {
  const svc = createIntelligenceDigestService({ storage: createMemoryStorage(), now: () => NOW });
  for (let i = 0; i < 5; i++) svc.generate('1h');
  const recent = svc.getHistory(3);
  assert.equal(recent.length, 3);
  for (let i = 1; i < recent.length; i++) {
    assert.ok(recent[i - 1]!.generatedAt >= recent[i]!.generatedAt);
  }
});

// ── Persistence + subscribe + ring buffer ───────────────────────────────

test('persist + rehydrate round-trip preserves digests', () => {
  const storage = createMemoryStorage();
  const svc1 = createIntelligenceDigestService({ storage, now: () => NOW });
  const d = svc1.generate('24h');
  const svc2 = createIntelligenceDigestService({ storage, now: () => NOW });
  assert.equal(svc2.getLatestDigest()!.id, d.id);
});

test('subscribe fires on generate', () => {
  const svc = createIntelligenceDigestService({ storage: createMemoryStorage(), now: () => NOW });
  let calls = 0;
  svc.subscribe(() => { calls += 1; });
  svc.generate('1h');
  svc.generate('24h');
  assert.equal(calls, 2);
});

test('unsubscribe stops further callbacks', () => {
  const svc = createIntelligenceDigestService({ storage: createMemoryStorage(), now: () => NOW });
  let calls = 0;
  const cb = (): void => { calls += 1; };
  svc.subscribe(cb);
  svc.generate('1h');
  svc.unsubscribe(cb);
  svc.generate('1h');
  assert.equal(calls, 1);
});

test('ring buffer caps at MAX_DIGESTS', () => {
  const svc = createIntelligenceDigestService({ storage: createMemoryStorage(), now: () => NOW });
  for (let i = 0; i < MAX_DIGESTS + 5; i++) svc.generate('1h');
  assert.equal(svc.getHistory(1000).length, MAX_DIGESTS);
});

// ── Shape integrity ─────────────────────────────────────────────────────

test('getHistory returns immutable snapshots', () => {
  const svc = createIntelligenceDigestService({ storage: createMemoryStorage(), now: () => NOW });
  svc.generate('1h');
  const snap = svc.getHistory();
  snap[0]!.headline = 'mutated';
  assert.notEqual(svc.getHistory()[0]!.headline, 'mutated');
});

test('every digest carries id, generatedAt, period, sections, totalAlerts, criticalCount, topRisks', () => {
  const svc = createIntelligenceDigestService({ storage: createMemoryStorage(), now: () => NOW });
  const d = svc.generate('6h');
  assert.ok(d.id);
  assert.equal(typeof d.generatedAt, 'number');
  assert.equal(d.period, '6h');
  assert.ok(Array.isArray(d.sections));
  assert.equal(typeof d.totalAlerts, 'number');
  assert.equal(typeof d.criticalCount, 'number');
  assert.ok(Array.isArray(d.topRisks));
});

test('DigestPeriod type accepts the three spec values', () => {
  const ps: DigestPeriod[] = ['1h', '6h', '24h'];
  assert.equal(ps.length, 3);
});

// ── DigestItem severity mapping ─────────────────────────────────────────

test('each DigestItem carries domain + severity + summary', () => {
  const situations = [sit({ id: 'a', domain: 'cyber', severity: 'high', summary: 'breach' })];
  const svc = createIntelligenceDigestService({
    storage: createMemoryStorage(), now: () => NOW,
    situationsProvider: { getRecent: () => situations },
  });
  const d = svc.generate('1h');
  const item: DigestItem | undefined = d.sections
    .flatMap((s) => s.items)
    .find((i) => i.situationId === 'a');
  assert.ok(item);
  assert.equal(item!.domain, 'cyber');
  assert.equal(item!.severity, 'high');
});
