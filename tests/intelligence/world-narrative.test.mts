import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  WorldNarrativeEngine,
  resetForTests,
  type WorldNarrative,
} from '../../src/services/intelligence/world-narrative.ts';
import type { ObservationEvent } from '../../src/services/intelligence/observation-adapters.ts';
import type { Situation } from '../../src/services/intelligence/situation-store-v2.ts';

const NOW = 1_745_000_000_000;

function makeEvent(overrides: Partial<ObservationEvent> = {}): ObservationEvent {
  return {
    id: 'ev-' + Math.random().toString(36).slice(2, 8),
    sourceId: 'test',
    domain: 'weather',
    timestamp: NOW - 30 * 60_000,
    severity: 'MEDIUM',
    title: 'Test event',
    raw: null,
    entityIds: [],
    tags: [],
    ...overrides,
  };
}

function makeSituation(overrides: Partial<Situation> = {}): Situation {
  return {
    id: 'sit-' + Math.random().toString(36).slice(2, 8),
    name: 'Test Situation',
    domain: 'weather',
    relatedDomains: [],
    severity: 'high',
    status: 'active',
    summary: '',
    observations: [],
    edges: [],
    entityIds: [],
    confidence: 0.7,
    startedAt: new Date(NOW),
    updatedAt: new Date(NOW),
    tags: [],
    ...overrides,
  };
}

// ── Empty input ─────────────────────────────────────────────────────

describe('WorldNarrativeEngine.generate — empty', () => {
  beforeEach(() => { resetForTests(); });

  it('no observations, no situations → quiet headline and 0 sections', () => {
    const e = new WorldNarrativeEngine({ now: () => NOW });
    const n = e.generate([], []);
    assert.equal(n.sections.length, 0);
    assert.equal(n.situationCount, 0);
    assert.equal(n.criticalAlertCount, 0);
    assert.ok(n.headline.length > 0);
    assert.match(n.headline, /quiet|nominal|stable/i);
  });

  it('every narrative carries generatedAt + executiveSummary + outlookSentence', () => {
    const e = new WorldNarrativeEngine({ now: () => NOW });
    const n = e.generate([], []);
    assert.equal(n.generatedAt, NOW);
    assert.ok(n.executiveSummary.length > 0);
    assert.ok(n.outlookSentence.length > 0);
    assert.ok(n.dominantTheme.length > 0);
  });
});

// ── Headline ────────────────────────────────────────────────────────

describe('WorldNarrativeEngine — headline', () => {
  beforeEach(() => { resetForTests(); });

  it('headline mentions the elevated label when overall pulse is elevated', () => {
    const e = new WorldNarrativeEngine({ now: () => NOW });
    const obs: ObservationEvent[] = [];
    for (let i = 0; i < 5; i++) obs.push(makeEvent({ id: `h-${i}`, domain: 'cyber', severity: 'HIGH' }));
    const n = e.generate(obs, []);
    assert.match(n.headline, /elevated/i);
  });

  it('headline mentions the dominant domain', () => {
    const e = new WorldNarrativeEngine({ now: () => NOW });
    const obs: ObservationEvent[] = [];
    for (let i = 0; i < 3; i++) obs.push(makeEvent({ id: `q-${i}`, domain: 'earthquake', severity: 'CRITICAL' }));
    const n = e.generate(obs, []);
    assert.match(n.headline, /earthquake/i);
  });

  it('headline does not contain raw slot placeholders', () => {
    const e = new WorldNarrativeEngine({ now: () => NOW });
    const obs = [makeEvent({ id: 'a', domain: 'weather', severity: 'CRITICAL' })];
    const n = e.generate(obs, []);
    assert.ok(!/\[[A-Z_]+\]/.test(n.headline), `placeholder leaked: ${n.headline}`);
  });
});

// ── Sections ────────────────────────────────────────────────────────

describe('WorldNarrativeEngine — sections', () => {
  beforeEach(() => { resetForTests(); });

  it('returns up to 3 sections ordered by domain stress (severity × count)', () => {
    const e = new WorldNarrativeEngine({ now: () => NOW });
    const obs: ObservationEvent[] = [
      makeEvent({ id: 'a', domain: 'earthquake', severity: 'CRITICAL' }),
      makeEvent({ id: 'b', domain: 'cyber', severity: 'MEDIUM' }),
      makeEvent({ id: 'c', domain: 'cyber', severity: 'MEDIUM' }),
      makeEvent({ id: 'd', domain: 'weather', severity: 'HIGH' }),
      makeEvent({ id: 'e', domain: 'maritime', severity: 'LOW' }),
    ];
    const n = e.generate(obs, []);
    assert.ok(n.sections.length <= 3);
    // Earthquake CRITICAL = 15, weather HIGH = 8, cyber 2×MEDIUM = 6.
    assert.equal(n.sections[0]?.domain, 'earthquake');
  });

  it('each section has title, body, severity, domain, confidence in [0,1]', () => {
    const e = new WorldNarrativeEngine({ now: () => NOW });
    const obs = [makeEvent({ id: 'a', domain: 'earthquake', severity: 'CRITICAL' })];
    const n = e.generate(obs, []);
    const s = n.sections[0]!;
    assert.ok(s.title.length > 0);
    assert.ok(s.body.length > 0);
    assert.ok(s.severity.length > 0);
    assert.ok(s.domain.length > 0);
    assert.ok(s.confidence >= 0 && s.confidence <= 1);
  });

  it('section bodies do not contain raw slot placeholders', () => {
    const e = new WorldNarrativeEngine({ now: () => NOW });
    const obs = [
      makeEvent({ id: 'a', domain: 'earthquake', severity: 'CRITICAL', title: 'M7.4 quake near Sendai', entityIds: ['JP-04'] }),
      makeEvent({ id: 'b', domain: 'biosurveillance', severity: 'HIGH', entityIds: ['IL-3'] }),
      makeEvent({ id: 'c', domain: 'cyber', severity: 'HIGH', entityIds: ['CVE-2026-0001'] }),
    ];
    const n = e.generate(obs, []);
    for (const section of n.sections) {
      assert.ok(!/\[[A-Z_]+\]/.test(section.body), `placeholder leaked in ${section.domain}: ${section.body}`);
    }
  });

  it('section body interpolates the observation count', () => {
    const e = new WorldNarrativeEngine({ now: () => NOW });
    const obs: ObservationEvent[] = [];
    for (let i = 0; i < 4; i++) obs.push(makeEvent({ id: `q-${i}`, domain: 'earthquake', severity: 'HIGH' }));
    const n = e.generate(obs, []);
    const eq = n.sections.find((s) => s.domain === 'earthquake')!;
    assert.match(eq.body, /4/);
  });

  it('section body interpolates entity names when present', () => {
    const e = new WorldNarrativeEngine({ now: () => NOW });
    const obs = [
      makeEvent({ id: 'a', domain: 'maritime', severity: 'HIGH', entityIds: ['IRGCN-9117001'] }),
    ];
    const n = e.generate(obs, []);
    const maritime = n.sections.find((s) => s.domain === 'maritime')!;
    assert.match(maritime.body, /IRGCN-9117001/);
  });

  it('section body uses the event title when no entityIds are present', () => {
    const e = new WorldNarrativeEngine({ now: () => NOW });
    const obs = [
      makeEvent({ id: 'a', domain: 'weather', severity: 'CRITICAL', title: 'Hurricane Yara approaching Cuba' }),
    ];
    const n = e.generate(obs, []);
    const weather = n.sections.find((s) => s.domain === 'weather')!;
    assert.match(weather.body, /Hurricane Yara|approaching Cuba/);
  });
});

// ── Domain coverage ─────────────────────────────────────────────────

describe('WorldNarrativeEngine — domain templates', () => {
  beforeEach(() => { resetForTests(); });

  function paragraphFor(domain: string): string {
    const e = new WorldNarrativeEngine({ now: () => NOW });
    const obs = [makeEvent({ id: 'a', domain, severity: 'HIGH' })];
    const n = e.generate(obs, []);
    return n.sections.find((s) => s.domain === domain)?.body ?? '';
  }

  it('earthquake template fires', () => {
    assert.match(paragraphFor('earthquake'), /seismic|epicenter|magnitude/i);
  });
  it('weather template fires', () => {
    assert.match(paragraphFor('weather'), /weather|storm|wind|precip/i);
  });
  it('biosurveillance template fires', () => {
    assert.match(paragraphFor('biosurveillance'), /outbreak|biosurv|wastewater|disease/i);
  });
  it('cyber template fires', () => {
    assert.match(paragraphFor('cyber'), /cyber|cve|vulnerab|threat actor/i);
  });
  it('maritime template fires', () => {
    assert.match(paragraphFor('maritime'), /maritime|vessel|chokepoint|ais/i);
  });
  it('aviation template fires', () => {
    assert.match(paragraphFor('aviation'), /aviation|flight|airspace|aircraft/i);
  });
  it('space-weather template fires', () => {
    assert.match(paragraphFor('space-weather'), /space weather|geomagnetic|kp|coronal/i);
  });
  it('geopolitical template fires', () => {
    assert.match(paragraphFor('geopolitical'), /geopolitical|conflict|diplomatic|sanction/i);
  });

  it('unknown domain falls back to generic template instead of dropping the section', () => {
    const e = new WorldNarrativeEngine({ now: () => NOW });
    const n = e.generate([makeEvent({ id: 'a', domain: 'unknown-domain', severity: 'CRITICAL' })], []);
    const section = n.sections.find((s) => s.domain === 'unknown-domain');
    assert.ok(section);
    assert.ok(section.body.length > 0);
  });
});

// ── Counters ────────────────────────────────────────────────────────

describe('WorldNarrativeEngine — counters', () => {
  beforeEach(() => { resetForTests(); });

  it('situationCount reflects situation input length', () => {
    const e = new WorldNarrativeEngine({ now: () => NOW });
    const n = e.generate([], [makeSituation({ id: 'a' }), makeSituation({ id: 'b' })]);
    assert.equal(n.situationCount, 2);
  });

  it('criticalAlertCount counts observations with severity CRITICAL', () => {
    const e = new WorldNarrativeEngine({ now: () => NOW });
    const n = e.generate([
      makeEvent({ id: 'a', severity: 'CRITICAL' }),
      makeEvent({ id: 'b', severity: 'HIGH' }),
      makeEvent({ id: 'c', severity: 'CRITICAL' }),
    ], []);
    assert.equal(n.criticalAlertCount, 2);
  });

  it('dominantTheme references the top-stressed domain', () => {
    const e = new WorldNarrativeEngine({ now: () => NOW });
    const n = e.generate([
      makeEvent({ id: 'a', domain: 'earthquake', severity: 'CRITICAL' }),
      makeEvent({ id: 'b', domain: 'cyber', severity: 'LOW' }),
    ], []);
    assert.match(n.dominantTheme, /earthquake/i);
  });
});

// ── outlookSentence ─────────────────────────────────────────────────

describe('WorldNarrativeEngine — outlook', () => {
  beforeEach(() => { resetForTests(); });

  it('first narrative outlook reflects current state ("holding steady")', () => {
    const e = new WorldNarrativeEngine({ now: () => NOW });
    const n = e.generate([], []);
    assert.match(n.outlookSentence, /steady|hold|nominal|stable/i);
  });

  it('outlook shifts to "deteriorating" when score drops between narratives', () => {
    let t = NOW;
    const e = new WorldNarrativeEngine({ now: () => t });
    e.generate([makeEvent({ id: 'calm', domain: 'cyber', severity: 'LOW' })], []);
    t = NOW + 60_000;
    const n2 = e.generate([
      makeEvent({ id: 'a', domain: 'cyber', severity: 'CRITICAL' }),
      makeEvent({ id: 'b', domain: 'cyber', severity: 'CRITICAL' }),
      makeEvent({ id: 'c', domain: 'cyber', severity: 'CRITICAL' }),
    ], []);
    assert.match(n2.outlookSentence, /deteriorat|degrad|worsen/i);
  });

  it('outlook shifts to "improving" when score recovers between narratives', () => {
    let t = NOW;
    const e = new WorldNarrativeEngine({ now: () => t });
    e.generate([
      makeEvent({ id: 'a', domain: 'cyber', severity: 'CRITICAL' }),
      makeEvent({ id: 'b', domain: 'cyber', severity: 'CRITICAL' }),
      makeEvent({ id: 'c', domain: 'cyber', severity: 'CRITICAL' }),
    ], []);
    t = NOW + 60_000;
    const n2 = e.generate([], []);
    assert.match(n2.outlookSentence, /improv|recover|easing|stable/i);
  });
});

// ── Accessors ───────────────────────────────────────────────────────

describe('WorldNarrativeEngine — accessors', () => {
  beforeEach(() => { resetForTests(); });

  it('getLatestNarrative returns the most recent generate output', () => {
    const e = new WorldNarrativeEngine({ now: () => NOW });
    const n = e.generate([], []);
    assert.deepEqual(e.getLatestNarrative(), n);
  });

  it('getLatestNarrative is undefined before any generate', () => {
    const e = new WorldNarrativeEngine({ now: () => NOW });
    assert.equal(e.getLatestNarrative(), undefined);
  });

  it('getHistory returns most-recent narratives within limit', () => {
    let t = NOW;
    const e = new WorldNarrativeEngine({ now: () => t });
    for (let i = 0; i < 15; i++) { e.generate([], []); t += 60_000; }
    const history = e.getHistory();
    assert.equal(history.length, 10);
  });
});

// ── Subscribe ───────────────────────────────────────────────────────

describe('WorldNarrativeEngine — subscribe', () => {
  beforeEach(() => { resetForTests(); });

  it('subscribe fires on generate', () => {
    const e = new WorldNarrativeEngine({ now: () => NOW });
    let calls = 0;
    let last: WorldNarrative | null = null;
    e.subscribe((n) => { calls++; last = n; });
    const out = e.generate([], []);
    assert.equal(calls, 1);
    assert.deepEqual(last, out);
  });

  it('unsubscribe stops further callbacks', () => {
    const e = new WorldNarrativeEngine({ now: () => NOW });
    let calls = 0;
    const cb = () => { calls++; };
    e.subscribe(cb);
    e.generate([], []);
    e.unsubscribe(cb);
    e.generate([], []);
    assert.equal(calls, 1);
  });
});

// ── Persistence ─────────────────────────────────────────────────────

describe('WorldNarrativeEngine — persistence', () => {
  beforeEach(() => { resetForTests(); });

  it('persists to and restores from a storage seam', () => {
    const fakeStorage: Record<string, string> = {};
    const storage = {
      getItem: (k: string) => fakeStorage[k] ?? null,
      setItem: (k: string, v: string) => { fakeStorage[k] = v; },
    };
    const a = new WorldNarrativeEngine({ now: () => NOW, storage });
    a.generate([makeEvent({ id: 'a', severity: 'CRITICAL' })], []);
    const b = new WorldNarrativeEngine({ now: () => NOW, storage });
    assert.ok(b.getLatestNarrative());
  });

  it('ring buffer caps history at supplied capacity', () => {
    let t = NOW;
    const e = new WorldNarrativeEngine({ now: () => t, capacity: 3 });
    for (let i = 0; i < 6; i++) { e.generate([], []); t += 60_000; }
    assert.ok(e.getHistory(100).length <= 3);
  });

  it('corrupted storage falls back to empty', () => {
    const storage = { getItem: () => '{not-json', setItem: () => {} };
    const e = new WorldNarrativeEngine({ now: () => NOW, storage });
    assert.equal(e.getLatestNarrative(), undefined);
  });
});
