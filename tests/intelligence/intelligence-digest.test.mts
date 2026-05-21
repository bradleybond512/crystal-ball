import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createIntelligenceDigestService,
  IntelligenceDigestService,
  STORAGE_KEY,
  MAX_DIGESTS,
  MAX_ENTRIES,
  DIGEST_ENTRY_KEY,
  type DigestPeriod,
  type DigestItem,
  type DigestSituation,
  type DigestSignatureMatch,
  type DigestContradiction,
  type DigestFailurePrediction,
  type DigestObservation,
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

test('MAX_DIGESTS is 100', () => {
  assert.equal(MAX_DIGESTS, 100);
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

// ═══════════════════════════════════════════════════════════════════════════
// IntelligenceDigestService class (v2)
// ═══════════════════════════════════════════════════════════════════════════

const CLASS_NOW = 1_700_000_000_000; // fixed clock for class tests
const HOUR_MS = 60 * 60_000;

function obs(domain: string, severity: number, hoursAgo: number, extra: Partial<DigestObservation> = {}): DigestObservation {
  return { domain, severity, timestamp: CLASS_NOW - hoursAgo * HOUR_MS, ...extra };
}

function makeProvider(observations: DigestObservation[]): { getAll(): DigestObservation[] } {
  return { getAll: () => observations };
}

// ── Construction ────────────────────────────────────────────────────────────

test('IntelligenceDigestService: constructs without arguments', () => {
  IntelligenceDigestService.resetForTests();
  const svc = new IntelligenceDigestService({ storage: null });
  assert.ok(svc instanceof IntelligenceDigestService);
});

test('IntelligenceDigestService: getInstance returns the same instance', () => {
  IntelligenceDigestService.resetForTests();
  const a = IntelligenceDigestService.getInstance();
  const b = IntelligenceDigestService.getInstance();
  assert.strictEqual(a, b);
});

test('IntelligenceDigestService: resetForTests makes getInstance return a fresh instance', () => {
  IntelligenceDigestService.resetForTests();
  const a = IntelligenceDigestService.getInstance();
  IntelligenceDigestService.resetForTests();
  const b = IntelligenceDigestService.getInstance();
  assert.notStrictEqual(a, b);
});

// ── generateDigest: basic shape ─────────────────────────────────────────────

test('IntelligenceDigestService: generateDigest returns DigestEntry shape', () => {
  const svc = new IntelligenceDigestService({ storage: null, now: () => CLASS_NOW });
  const entry = svc.generateDigest();
  assert.equal(typeof entry.id, 'string');
  assert.equal(typeof entry.generatedAt, 'number');
  assert.equal(entry.windowHours, 24);
  assert.ok(Array.isArray(entry.topThreats));
  assert.ok(Array.isArray(entry.domainHighlights));
  assert.ok(Array.isArray(entry.trendChanges));
  assert.ok(Array.isArray(entry.recommendedFocus));
});

test('IntelligenceDigestService: generateDigest with no provider yields empty arrays', () => {
  const svc = new IntelligenceDigestService({ storage: null, now: () => CLASS_NOW });
  const entry = svc.generateDigest(24);
  assert.equal(entry.topThreats.length, 0);
  assert.equal(entry.domainHighlights.length, 0);
  assert.equal(entry.trendChanges.length, 0);
  assert.equal(entry.recommendedFocus.length, 0);
});

test('IntelligenceDigestService: generateDigest windowHours is echoed in entry', () => {
  const svc = new IntelligenceDigestService({ storage: null, now: () => CLASS_NOW });
  const entry = svc.generateDigest(12);
  assert.equal(entry.windowHours, 12);
});

test('IntelligenceDigestService: each id is unique across calls', () => {
  const svc = new IntelligenceDigestService({ storage: null, now: () => CLASS_NOW });
  const a = svc.generateDigest();
  const b = svc.generateDigest();
  assert.notEqual(a.id, b.id);
});

// ── topThreats ordering ─────────────────────────────────────────────────────

test('IntelligenceDigestService: topThreats ordered by severity descending', () => {
  const provider = makeProvider([
    obs('weather', 3, 1),
    obs('cyber', 8, 2),
    obs('finance', 5, 3),
  ]);
  const svc = new IntelligenceDigestService({ observationProvider: provider, storage: null, now: () => CLASS_NOW });
  const entry = svc.generateDigest(24);
  assert.equal(entry.topThreats[0]!.domain, 'cyber');
  assert.equal(entry.topThreats[1]!.domain, 'finance');
  assert.equal(entry.topThreats[2]!.domain, 'weather');
});

test('IntelligenceDigestService: topThreats limited to 5 domains', () => {
  const domains = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
  const provider = makeProvider(domains.map((d, i) => obs(d, i + 1, 1)));
  const svc = new IntelligenceDigestService({ observationProvider: provider, storage: null, now: () => CLASS_NOW });
  const entry = svc.generateDigest(24);
  assert.ok(entry.topThreats.length <= 5);
});

test('IntelligenceDigestService: topThreats carries correct severity', () => {
  const provider = makeProvider([obs('cyber', 7.5, 1)]);
  const svc = new IntelligenceDigestService({ observationProvider: provider, storage: null, now: () => CLASS_NOW });
  const entry = svc.generateDigest(24);
  assert.equal(entry.topThreats[0]!.severity, 7.5);
});

test('IntelligenceDigestService: topThreats carries eventCount and regionCount', () => {
  const provider = makeProvider([obs('geo', 6, 1, { eventCount: 3, regionCount: 2 })]);
  const svc = new IntelligenceDigestService({ observationProvider: provider, storage: null, now: () => CLASS_NOW });
  const entry = svc.generateDigest(24);
  assert.equal(entry.topThreats[0]!.eventCount, 3);
  assert.equal(entry.topThreats[0]!.regionCount, 2);
});

test('IntelligenceDigestService: topThreats headline uses observation headline', () => {
  const provider = makeProvider([obs('cyber', 6, 1, { headline: 'Zero-day exploited' })]);
  const svc = new IntelligenceDigestService({ observationProvider: provider, storage: null, now: () => CLASS_NOW });
  const entry = svc.generateDigest(24);
  assert.equal(entry.topThreats[0]!.headline, 'Zero-day exploited');
});

// ── domainHighlights status ─────────────────────────────────────────────────

test('IntelligenceDigestService: domain is escalating when recent > prior + 0.5', () => {
  // prior: 10h ago (within 24h window but outside 6h recent)
  // recent: 2h ago (within 6h recent)
  const provider = makeProvider([
    obs('cyber', 4, 10), // prior bucket
    obs('cyber', 7, 2),  // recent bucket (delta = 3 >= 0.5 → escalating)
  ]);
  const svc = new IntelligenceDigestService({ observationProvider: provider, storage: null, now: () => CLASS_NOW });
  const entry = svc.generateDigest(24);
  const h = entry.domainHighlights.find((d) => d.domain === 'cyber');
  assert.equal(h?.status, 'escalating');
});

test('IntelligenceDigestService: domain is de-escalating when recent < prior - 0.5', () => {
  const provider = makeProvider([
    obs('finance', 8, 10), // prior bucket
    obs('finance', 2, 2),  // recent bucket (delta = -6 <= -0.5 → de-escalating)
  ]);
  const svc = new IntelligenceDigestService({ observationProvider: provider, storage: null, now: () => CLASS_NOW });
  const entry = svc.generateDigest(24);
  const h = entry.domainHighlights.find((d) => d.domain === 'finance');
  assert.equal(h?.status, 'de-escalating');
});

test('IntelligenceDigestService: domain is stable when delta < 0.5', () => {
  const provider = makeProvider([
    obs('weather', 5, 10), // prior
    obs('weather', 5.3, 2), // recent (delta = 0.3 < 0.5 → stable)
  ]);
  const svc = new IntelligenceDigestService({ observationProvider: provider, storage: null, now: () => CLASS_NOW });
  const entry = svc.generateDigest(24);
  const h = entry.domainHighlights.find((d) => d.domain === 'weather');
  assert.equal(h?.status, 'stable');
});

test('IntelligenceDigestService: domain with only recent obs defaults prior to 0 (escalating)', () => {
  const provider = makeProvider([obs('cyber', 5, 1)]); // only recent, no prior
  const svc = new IntelligenceDigestService({ observationProvider: provider, storage: null, now: () => CLASS_NOW });
  const entry = svc.generateDigest(24);
  const h = entry.domainHighlights.find((d) => d.domain === 'cyber');
  // recentMaxSev=5, priorMaxSev=0, delta=5 >= 0.5 → escalating
  assert.equal(h?.status, 'escalating');
});

// ── trendChanges threshold ─────────────────────────────────────────────────

test('IntelligenceDigestService: trendChange recorded when delta >= 1', () => {
  const provider = makeProvider([
    obs('geo', 3, 10), // prior
    obs('geo', 7, 2),  // recent (delta = 4 >= 1)
  ]);
  const svc = new IntelligenceDigestService({ observationProvider: provider, storage: null, now: () => CLASS_NOW });
  const entry = svc.generateDigest(24);
  const tc = entry.trendChanges.find((t) => t.domain === 'geo');
  assert.ok(tc, 'expected a trendChange for geo');
  assert.equal(tc!.changeDirection, 'up');
  assert.equal(tc!.previousSeverity, 3);
  assert.equal(tc!.currentSeverity, 7);
});

test('IntelligenceDigestService: no trendChange when |delta| < 1', () => {
  const provider = makeProvider([
    obs('weather', 5, 10), // prior
    obs('weather', 5.4, 2), // recent (|delta| = 0.4 < 1)
  ]);
  const svc = new IntelligenceDigestService({ observationProvider: provider, storage: null, now: () => CLASS_NOW });
  const entry = svc.generateDigest(24);
  assert.equal(entry.trendChanges.length, 0);
});

test('IntelligenceDigestService: trendChange direction is down when recent < prior - 1', () => {
  const provider = makeProvider([
    obs('finance', 9, 10), // prior
    obs('finance', 3, 2),  // recent (delta = -6)
  ]);
  const svc = new IntelligenceDigestService({ observationProvider: provider, storage: null, now: () => CLASS_NOW });
  const entry = svc.generateDigest(24);
  const tc = entry.trendChanges.find((t) => t.domain === 'finance');
  assert.equal(tc?.changeDirection, 'down');
});

// ── recommendedFocus ────────────────────────────────────────────────────────

test('IntelligenceDigestService: recommendedFocus holds top-3 threat domains', () => {
  const provider = makeProvider([
    obs('a', 9, 1), obs('b', 7, 1), obs('c', 5, 1), obs('d', 3, 1),
  ]);
  const svc = new IntelligenceDigestService({ observationProvider: provider, storage: null, now: () => CLASS_NOW });
  const entry = svc.generateDigest(24);
  assert.deepEqual(entry.recommendedFocus, ['a', 'b', 'c']);
});

test('IntelligenceDigestService: recommendedFocus has at most 3 entries', () => {
  const provider = makeProvider(['x', 'y', 'z', 'w', 'v'].map((d, i) => obs(d, i + 1, 1)));
  const svc = new IntelligenceDigestService({ observationProvider: provider, storage: null, now: () => CLASS_NOW });
  const entry = svc.generateDigest(24);
  assert.ok(entry.recommendedFocus.length <= 3);
});

test('IntelligenceDigestService: recommendedFocus is empty when no observations', () => {
  const svc = new IntelligenceDigestService({ storage: null, now: () => CLASS_NOW });
  const entry = svc.generateDigest(24);
  assert.equal(entry.recommendedFocus.length, 0);
});

// ── getLatest / getHistory ──────────────────────────────────────────────────

test('IntelligenceDigestService: getLatest returns undefined before any digest', () => {
  const svc = new IntelligenceDigestService({ storage: null, now: () => CLASS_NOW });
  assert.equal(svc.getLatest(), undefined);
});

test('IntelligenceDigestService: getLatest returns last generated entry', () => {
  const svc = new IntelligenceDigestService({ storage: null, now: () => CLASS_NOW });
  svc.generateDigest(6);
  const second = svc.generateDigest(12);
  const latest = svc.getLatest();
  assert.equal(latest?.id, second.id);
});

test('IntelligenceDigestService: getHistory returns entries in reverse-chronological order', () => {
  let tick = CLASS_NOW;
  const svc = new IntelligenceDigestService({ storage: null, now: () => tick++ });
  const first = svc.generateDigest(24);
  const second = svc.generateDigest(24);
  const history = svc.getHistory();
  assert.equal(history[0]!.id, second.id);
  assert.equal(history[1]!.id, first.id);
});

test('IntelligenceDigestService: getHistory respects limit parameter', () => {
  const svc = new IntelligenceDigestService({ storage: null, now: () => CLASS_NOW });
  for (let i = 0; i < 10; i++) svc.generateDigest(24);
  assert.equal(svc.getHistory(3).length, 3);
});

test('IntelligenceDigestService: getHistory default limit is 20', () => {
  const svc = new IntelligenceDigestService({ storage: null, now: () => CLASS_NOW });
  for (let i = 0; i < 25; i++) svc.generateDigest(24);
  assert.equal(svc.getHistory().length, 20);
});

// ── MAX_ENTRIES cap ─────────────────────────────────────────────────────────

test('IntelligenceDigestService: MAX_ENTRIES is 100', () => {
  assert.equal(MAX_ENTRIES, 100);
});

test('IntelligenceDigestService: history never exceeds MAX_ENTRIES', () => {
  const svc = new IntelligenceDigestService({ storage: null, now: () => CLASS_NOW });
  for (let i = 0; i < 110; i++) svc.generateDigest(24);
  assert.ok(svc.getHistory(200).length <= 100);
});

// ── Storage persistence and rehydration ────────────────────────────────────

test('IntelligenceDigestService: DIGEST_ENTRY_KEY constant is correct', () => {
  assert.equal(DIGEST_ENTRY_KEY, 'wm-intelligence-digest');
});

test('IntelligenceDigestService: persists entries to storage', () => {
  const storage = createMemoryStorage();
  const svc = new IntelligenceDigestService({ storage, now: () => CLASS_NOW });
  svc.generateDigest(24);
  const raw = storage.getItem(DIGEST_ENTRY_KEY);
  assert.ok(raw !== null);
  const parsed = JSON.parse(raw!);
  assert.equal(parsed.length, 1);
});

test('IntelligenceDigestService: rehydrates entries from storage on construction', () => {
  const storage = createMemoryStorage();
  const svc1 = new IntelligenceDigestService({ storage, now: () => CLASS_NOW });
  svc1.generateDigest(24);
  const svc2 = new IntelligenceDigestService({ storage, now: () => CLASS_NOW });
  assert.equal(svc2.getHistory().length, 1);
});

test('IntelligenceDigestService: rehydrated entries survive getLatest', () => {
  const storage = createMemoryStorage();
  const svc1 = new IntelligenceDigestService({ storage, now: () => CLASS_NOW });
  const original = svc1.generateDigest(12);
  const svc2 = new IntelligenceDigestService({ storage, now: () => CLASS_NOW });
  const latest = svc2.getLatest();
  assert.equal(latest?.id, original.id);
  assert.equal(latest?.windowHours, 12);
});

test('IntelligenceDigestService: null storage does not throw on generateDigest', () => {
  const svc = new IntelligenceDigestService({ storage: null, now: () => CLASS_NOW });
  assert.doesNotThrow(() => svc.generateDigest(24));
});

test('IntelligenceDigestService: corrupted storage string does not throw', () => {
  const storage = createMemoryStorage();
  storage.setItem(DIGEST_ENTRY_KEY, '{not valid json[[[');
  assert.doesNotThrow(() => new IntelligenceDigestService({ storage, now: () => CLASS_NOW }));
});

// ── Window hours boundary ────────────────────────────────────────────────────

test('IntelligenceDigestService: observations outside window are excluded', () => {
  // obs 30h ago — outside the 24h window
  const provider = makeProvider([obs('geo', 9, 30)]);
  const svc = new IntelligenceDigestService({ observationProvider: provider, storage: null, now: () => CLASS_NOW });
  const entry = svc.generateDigest(24);
  assert.equal(entry.topThreats.length, 0);
});

test('IntelligenceDigestService: observations just inside window are included', () => {
  // obs exactly 23h 59m ago — inside 24h window
  const provider = makeProvider([
    { domain: 'weather', severity: 8, timestamp: CLASS_NOW - (24 * HOUR_MS - 60_000) },
  ]);
  const svc = new IntelligenceDigestService({ observationProvider: provider, storage: null, now: () => CLASS_NOW });
  const entry = svc.generateDigest(24);
  assert.equal(entry.topThreats.length, 1);
});

test('IntelligenceDigestService: custom windowHours narrows included observations', () => {
  // one obs 2h ago, one obs 10h ago; with windowHours=6, only the 2h one qualifies
  const provider = makeProvider([obs('a', 9, 2), obs('b', 9, 10)]);
  const svc = new IntelligenceDigestService({ observationProvider: provider, storage: null, now: () => CLASS_NOW });
  const entry = svc.generateDigest(6);
  assert.equal(entry.topThreats.length, 1);
  assert.equal(entry.topThreats[0]!.domain, 'a');
});

// ── Clone isolation ──────────────────────────────────────────────────────────

test('IntelligenceDigestService: mutating returned entry does not affect getLatest', () => {
  const svc = new IntelligenceDigestService({ storage: null, now: () => CLASS_NOW });
  const entry = svc.generateDigest(24);
  entry.recommendedFocus.push('injected');
  const latest = svc.getLatest();
  assert.ok(!latest?.recommendedFocus.includes('injected'));
});

test('IntelligenceDigestService: mutating getHistory result does not affect stored entries', () => {
  const svc = new IntelligenceDigestService({ storage: null, now: () => CLASS_NOW });
  svc.generateDigest(24);
  const hist = svc.getHistory();
  (hist[0] as { windowHours: number }).windowHours = 999;
  assert.equal(svc.getLatest()!.windowHours, 24);
});
