import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createIntelligenceBriefingExportService,
  STORAGE_KEY,
  MAX_BRIEFINGS,
  type IntelligenceBriefing,
  type IntelligenceBriefingProviders,
} from '../../src/services/intelligence/intelligence-briefing-export.ts';
import type { Situation } from '../../src/types/intelligence.ts';

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

const NOW = new Date('2026-05-18T12:00:00Z');
const NOW_MS = NOW.getTime();

function makeSituation(overrides: Partial<Situation> = {}): Situation {
  return {
    id: 'sit-1',
    name: 'M6.2 near Tokyo',
    status: 'active',
    severity: 'high',
    domain: 'earthquake',
    startedAt: NOW_MS - 60_000,
    updatedAt: NOW_MS,
    observationIds: ['obs-1'],
    correlationIds: [],
    summary: 'Strong earthquake; aftershocks ongoing.',
    tags: [],
    confidence: 0.85,
    ...overrides,
  } as Situation;
}

function richProviders(): IntelligenceBriefingProviders {
  return {
    civilizationPulse: () => ({
      overallScore: 72,
      label: 'elevated',
      dominantStressor: 'earthquake',
    }),
    worldNarrative: () => ({
      headline: 'Active seismic activity in the western Pacific.',
      outlookSentence: 'Pacific Rim posture remains elevated.',
    }),
    activeSituations: () => [
      makeSituation({ id: 'sit-1', severity: 'critical' }),
      makeSituation({ id: 'sit-2', severity: 'high', name: 'Power grid cyber incident', domain: 'cyber' }),
      makeSituation({ id: 'sit-3', severity: 'medium', name: 'Severe storm — Gulf coast', domain: 'weather' }),
    ],
    threatHorizon: () => [
      {
        id: 'th-1',
        domain: 'maritime',
        region: 'Black Sea',
        currentSeverity: 'MEDIUM',
        projectedSeverity: 'HIGH',
        horizon: '48h',
        probability: 0.65,
      },
    ],
    upcomingEvents: () => [
      {
        id: 'evt-1',
        title: 'OPEC+ meeting',
        country: 'Austria',
        scheduledAt: NOW_MS + 21 * 24 * 60 * 60_000,
        riskLevel: 'high',
        type: 'summit',
      },
    ],
    systemHealth: () => ({
      overallScore: 0.91,
      overallStatus: 'ok',
    }),
  };
}

function makeSvc(providers?: IntelligenceBriefingProviders) {
  return createIntelligenceBriefingExportService({
    storage: createMemoryStorage(),
    now: () => NOW_MS,
    providers: providers ?? richProviders(),
  });
}

// ── Constants ────────────────────────────────────────────────────────────

test('STORAGE_KEY is "wm-intelligence-briefings"', () => {
  assert.equal(STORAGE_KEY, 'wm-intelligence-briefings');
});

test('MAX_BRIEFINGS is 50', () => {
  assert.equal(MAX_BRIEFINGS, 50);
});

// ── generate ─────────────────────────────────────────────────────────────

test('generate returns an IntelligenceBriefing with all required fields', () => {
  const b = makeSvc().generate();
  assert.ok(b.id);
  assert.ok(b.title);
  assert.ok(b.classification);
  assert.equal(b.generatedAt, NOW_MS);
  assert.ok(b.periodLabel);
  assert.ok(Array.isArray(b.sections));
  assert.ok(typeof b.htmlContent === 'string');
  assert.ok(b.wordCount > 0);
});

test('generate honors classification override', () => {
  const b = makeSvc().generate({ classification: 'sensitive' });
  assert.equal(b.classification, 'sensitive');
});

test('generate honors title override', () => {
  const b = makeSvc().generate({ title: 'Custom Daily Briefing' });
  assert.equal(b.title, 'Custom Daily Briefing');
});

test('generate produces a default classification when not given', () => {
  const b = makeSvc().generate();
  assert.ok(b.classification === 'unclassified' || b.classification === 'internal' || b.classification === 'sensitive');
});

// ── Sections ─────────────────────────────────────────────────────────────

test('briefing has an Executive Summary section', () => {
  const b = makeSvc().generate();
  assert.ok(b.sections.some((s) => /Executive Summary/i.test(s.title)));
});

test('briefing has an Active Situations section', () => {
  const b = makeSvc().generate();
  assert.ok(b.sections.some((s) => /Active Situations/i.test(s.title)));
});

test('briefing has a Threat Horizon section', () => {
  const b = makeSvc().generate();
  assert.ok(b.sections.some((s) => /Threat Horizon/i.test(s.title)));
});

test('briefing has an Upcoming Events section', () => {
  const b = makeSvc().generate();
  assert.ok(b.sections.some((s) => /Upcoming Events/i.test(s.title)));
});

test('briefing has a System Health section', () => {
  const b = makeSvc().generate();
  assert.ok(b.sections.some((s) => /System Health/i.test(s.title)));
});

test('sections are non-empty', () => {
  const b = makeSvc().generate();
  assert.ok(b.sections.length >= 5);
  for (const s of b.sections) {
    assert.ok(typeof s.title === 'string' && s.title.length > 0);
    assert.ok(typeof s.content === 'string' && s.content.length > 0);
    assert.ok(typeof s.priority === 'number');
  }
});

// ── Active Situations: top 5 cap + sort by severity ──────────────────────

test('Active Situations section caps at top 5', () => {
  const many: Situation[] = [];
  for (let i = 0; i < 10; i++) {
    many.push(makeSituation({ id: `sit-${i}`, severity: 'medium', name: `Event ${i}` }));
  }
  const providers = richProviders();
  providers.activeSituations = () => many;
  const b = makeSvc(providers).generate();
  const sit = b.sections.find((s) => /Active Situations/i.test(s.title));
  assert.ok(sit);
  // We can't directly count the bullets but the htmlContent must contain at most 5 sit-N markers
  const matches = (sit?.content ?? '').match(/sit-\d+/g) ?? [];
  assert.ok(matches.length <= 5, `expected <=5 entries, got ${matches.length}`);
});

test('Active Situations: "No active situations detected." when empty', () => {
  const providers = richProviders();
  providers.activeSituations = () => [];
  const b = makeSvc(providers).generate();
  const sit = b.sections.find((s) => /Active Situations/i.test(s.title));
  assert.ok(/No active situations/i.test(sit?.content ?? ''));
});

test('Threat Horizon: "No imminent threats projected." when empty', () => {
  const providers = richProviders();
  providers.threatHorizon = () => [];
  const b = makeSvc(providers).generate();
  const th = b.sections.find((s) => /Threat Horizon/i.test(s.title));
  assert.ok(/No imminent threats projected/i.test(th?.content ?? ''));
});

// ── htmlContent contents ─────────────────────────────────────────────────

test('htmlContent contains the classification label', () => {
  const b = makeSvc().generate({ classification: 'sensitive' });
  assert.ok(/sensitive/i.test(b.htmlContent));
});

test('htmlContent contains the title', () => {
  const b = makeSvc().generate({ title: 'My Briefing Title' });
  assert.ok(b.htmlContent.includes('My Briefing Title'));
});

test('htmlContent contains a classification banner styling', () => {
  const b = makeSvc().generate();
  // Banner has inline style — confirm we emit at least basic HTML markup
  assert.ok(/<header|<div[^>]*classification|<h1|<style/i.test(b.htmlContent));
});

test('htmlContent contains numbered or ordered sections', () => {
  const b = makeSvc().generate();
  // Each section heading should appear in the html
  for (const section of b.sections) {
    // Section title escaped — just look for first word
    const firstWord = section.title.split(' ')[0] ?? '';
    if (firstWord) assert.ok(b.htmlContent.includes(firstWord), `htmlContent missing "${firstWord}"`);
  }
});

test('htmlContent escapes HTML special characters in inputs', () => {
  const providers = richProviders();
  providers.worldNarrative = () => ({
    headline: '<script>alert(1)</script>',
    outlookSentence: 'safe',
  });
  const b = makeSvc(providers).generate();
  assert.ok(!b.htmlContent.includes('<script>alert(1)</script>'));
});

// ── wordCount ────────────────────────────────────────────────────────────

test('wordCount > 0 for non-empty briefing', () => {
  const b = makeSvc().generate();
  assert.ok(b.wordCount > 10);
});

test('wordCount reflects more content for larger sections', () => {
  const sparseProviders: IntelligenceBriefingProviders = {
    activeSituations: () => [],
    threatHorizon: () => [],
    upcomingEvents: () => [],
  };
  const sparseSvc = createIntelligenceBriefingExportService({
    storage: createMemoryStorage(),
    now: () => NOW_MS,
    providers: sparseProviders,
  });
  const sparse = sparseSvc.generate();
  const rich = makeSvc().generate();
  assert.ok(rich.wordCount > sparse.wordCount);
});

// ── Null-safety ──────────────────────────────────────────────────────────

test('generate works when ALL providers are null/absent', () => {
  const svc = createIntelligenceBriefingExportService({
    storage: createMemoryStorage(),
    now: () => NOW_MS,
    providers: {},
  });
  assert.doesNotThrow(() => svc.generate());
  const b = svc.generate();
  assert.ok(b.sections.length >= 5);
});

test('generate works when individual providers throw', () => {
  const providers: IntelligenceBriefingProviders = {
    civilizationPulse: () => { throw new Error('boom'); },
    worldNarrative: () => { throw new Error('boom'); },
    activeSituations: () => { throw new Error('boom'); },
    threatHorizon: () => { throw new Error('boom'); },
    upcomingEvents: () => { throw new Error('boom'); },
    systemHealth: () => { throw new Error('boom'); },
  };
  const svc = createIntelligenceBriefingExportService({
    storage: createMemoryStorage(),
    now: () => NOW_MS,
    providers,
  });
  assert.doesNotThrow(() => svc.generate());
});

// ── getLatest / getBriefings / persistence ───────────────────────────────

test('getLatest returns null when no briefings generated', () => {
  const svc = createIntelligenceBriefingExportService({
    storage: createMemoryStorage(),
    now: () => NOW_MS,
    providers: {},
  });
  assert.equal(svc.getLatest(), null);
});

test('getLatest returns the most recently generated briefing', () => {
  const svc = makeSvc();
  const a = svc.generate({ title: 'First' });
  const b = svc.generate({ title: 'Second' });
  const latest = svc.getLatest();
  assert.equal(latest?.id, b.id);
  assert.equal(latest?.title, 'Second');
  // First exists too
  assert.notEqual(latest?.id, a.id);
});

test('getBriefings returns LIFO order', () => {
  const svc = makeSvc();
  svc.generate({ title: 'a' });
  svc.generate({ title: 'b' });
  svc.generate({ title: 'c' });
  const list = svc.getBriefings();
  assert.equal(list[0]?.title, 'c');
  assert.equal(list[1]?.title, 'b');
  assert.equal(list[2]?.title, 'a');
});

test('getBriefings respects limit', () => {
  const svc = makeSvc();
  for (let i = 0; i < 5; i++) svc.generate({ title: `b${i}` });
  assert.equal(svc.getBriefings(3).length, 3);
});

test('briefings ring-buffer evicts oldest at MAX_BRIEFINGS', () => {
  const svc = makeSvc();
  for (let i = 0; i < MAX_BRIEFINGS + 5; i++) svc.generate({ title: `b${i}` });
  assert.ok(svc.getBriefings(MAX_BRIEFINGS + 10).length <= MAX_BRIEFINGS);
});

test('briefings persist across instances', () => {
  const storage = createMemoryStorage();
  const svc1 = createIntelligenceBriefingExportService({ storage, now: () => NOW_MS, providers: richProviders() });
  svc1.generate({ title: 'Persisted Briefing' });

  const svc2 = createIntelligenceBriefingExportService({ storage, now: () => NOW_MS, providers: {} });
  const list = svc2.getBriefings();
  assert.equal(list.length, 1);
  assert.equal(list[0]?.title, 'Persisted Briefing');
});

// ── subscribe ────────────────────────────────────────────────────────────

test('subscribe is notified on generate', () => {
  const svc = makeSvc();
  let calls = 0;
  let lastTitle: string | undefined;
  svc.subscribe((b: IntelligenceBriefing) => {
    calls += 1;
    lastTitle = b.title;
  });
  svc.generate({ title: 'sub-test' });
  assert.equal(calls, 1);
  assert.equal(lastTitle, 'sub-test');
});

test('unsubscribe stops notifications', () => {
  const svc = makeSvc();
  let calls = 0;
  const fn = () => { calls += 1; };
  svc.subscribe(fn);
  svc.unsubscribe(fn);
  svc.generate();
  assert.equal(calls, 0);
});
