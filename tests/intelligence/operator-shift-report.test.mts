import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  OperatorShiftReportService,
  resetForTests,
  type ShiftReport,
  type ShiftReportSources,
  type ShiftReportSituationSummary,
} from '../../src/services/intelligence/operator-shift-report.ts';

const NOW = 1_745_000_000_000;

function utcHourEpoch(hourUtc: number): number {
  // Build an epoch ms value at the given UTC hour on a fixed date.
  return Date.UTC(2026, 4, 18, hourUtc, 0, 0, 0);
}

function emptySources(overrides: Partial<ShiftReportSources> = {}): ShiftReportSources {
  return {
    getPulse: () => null,
    getNarrative: () => null,
    getTopSituations: () => [],
    getRecentAnomalyCount: () => 0,
    getFeedHealthSummary: () => 'all feeds nominal',
    ...overrides,
  };
}

function makeSituation(overrides: Partial<ShiftReportSituationSummary> = {}): ShiftReportSituationSummary {
  return {
    id: overrides.id ?? 'sit-' + Math.random().toString(36).slice(2, 8),
    domain: overrides.domain ?? 'earthquake',
    severity: overrides.severity ?? 'high',
    title: overrides.title ?? 'Test situation',
  };
}

// ── ShiftPeriod derivation ──────────────────────────────────────────

describe('OperatorShiftReportService — ShiftPeriod by UTC hour', () => {
  beforeEach(() => { resetForTests(); });

  it('hours 6-11 → morning', () => {
    for (const h of [6, 7, 8, 9, 10, 11]) {
      const s = new OperatorShiftReportService({ now: () => utcHourEpoch(h), sources: emptySources() });
      assert.equal(s.generate().period, 'morning', `hour ${h} should be morning`);
    }
  });

  it('hours 12-17 → afternoon', () => {
    for (const h of [12, 13, 14, 15, 16, 17]) {
      const s = new OperatorShiftReportService({ now: () => utcHourEpoch(h), sources: emptySources() });
      assert.equal(s.generate().period, 'afternoon', `hour ${h} should be afternoon`);
    }
  });

  it('hours 18-23 → evening', () => {
    for (const h of [18, 19, 20, 21, 22, 23]) {
      const s = new OperatorShiftReportService({ now: () => utcHourEpoch(h), sources: emptySources() });
      assert.equal(s.generate().period, 'evening', `hour ${h} should be evening`);
    }
  });

  it('hours 0-5 → night', () => {
    for (const h of [0, 1, 2, 3, 4, 5]) {
      const s = new OperatorShiftReportService({ now: () => utcHourEpoch(h), sources: emptySources() });
      assert.equal(s.generate().period, 'night', `hour ${h} should be night`);
    }
  });
});

// ── generate() shape contract ───────────────────────────────────────

describe('OperatorShiftReportService.generate — shape contract', () => {
  beforeEach(() => { resetForTests(); });

  it('returns a ShiftReport with all required fields', () => {
    const s = new OperatorShiftReportService({ now: () => NOW, sources: emptySources() });
    const r = s.generate();
    assert.ok(r.id.length > 0);
    assert.ok(['morning', 'afternoon', 'evening', 'night'].includes(r.period));
    assert.equal(r.generatedAt, NOW);
    assert.equal(r.civilizationScore, null);
    assert.equal(r.civilizationLabel, null);
    assert.deepEqual(r.topSituations, []);
    assert.equal(r.anomalyCount, 0);
    assert.equal(typeof r.feedHealthSummary, 'string');
    assert.equal(typeof r.worldNarrativeSummary, 'string');
    assert.ok(Array.isArray(r.keyDevelopments));
    assert.ok(Array.isArray(r.recommendedActions));
    assert.equal(typeof r.handoffNotes, 'string');
    assert.equal(typeof r.reportText, 'string');
  });

  it('handoffNotes parameter is preserved on the report', () => {
    const s = new OperatorShiftReportService({ now: () => NOW, sources: emptySources() });
    const r = s.generate('Watch for biosurv spike at 02:00Z');
    assert.equal(r.handoffNotes, 'Watch for biosurv spike at 02:00Z');
  });

  it('handoffNotes defaults to empty string when not provided', () => {
    const s = new OperatorShiftReportService({ now: () => NOW, sources: emptySources() });
    assert.equal(s.generate().handoffNotes, '');
  });
});

// ── Service integration: null-safe fallbacks ────────────────────────

describe('OperatorShiftReportService — null-safe sources', () => {
  beforeEach(() => { resetForTests(); });

  it('null pulse → null score + null label', () => {
    const s = new OperatorShiftReportService({ now: () => NOW, sources: emptySources() });
    const r = s.generate();
    assert.equal(r.civilizationScore, null);
    assert.equal(r.civilizationLabel, null);
  });

  it('pulse present → score + label populated', () => {
    const s = new OperatorShiftReportService({
      now: () => NOW,
      sources: emptySources({
        getPulse: () => ({ overallScore: 72, label: 'elevated' }),
      }),
    });
    const r = s.generate();
    assert.equal(r.civilizationScore, 72);
    assert.equal(r.civilizationLabel, 'elevated');
  });

  it('null narrative → empty worldNarrativeSummary', () => {
    const s = new OperatorShiftReportService({ now: () => NOW, sources: emptySources() });
    assert.equal(s.generate().worldNarrativeSummary, '');
  });

  it('narrative present → headline + executiveSummary truncated to 300 chars', () => {
    const longSummary = 'A'.repeat(500);
    const s = new OperatorShiftReportService({
      now: () => NOW,
      sources: emptySources({
        getNarrative: () => ({ headline: 'Global posture elevated.', executiveSummary: longSummary }),
      }),
    });
    const r = s.generate();
    assert.ok(r.worldNarrativeSummary.length <= 300);
    assert.match(r.worldNarrativeSummary, /Global posture elevated/);
  });

  it('topSituations carries through up to 5', () => {
    const sits = Array.from({ length: 10 }, (_, i) =>
      makeSituation({ id: `sit-${i}`, severity: 'high', domain: 'earthquake' }),
    );
    const s = new OperatorShiftReportService({
      now: () => NOW,
      sources: emptySources({ getTopSituations: () => sits }),
    });
    assert.equal(s.generate().topSituations.length, 5);
  });

  it('anomalyCount surfaces from source', () => {
    const s = new OperatorShiftReportService({
      now: () => NOW,
      sources: emptySources({ getRecentAnomalyCount: () => 7 }),
    });
    assert.equal(s.generate().anomalyCount, 7);
  });

  it('feedHealthSummary surfaces from source', () => {
    const s = new OperatorShiftReportService({
      now: () => NOW,
      sources: emptySources({ getFeedHealthSummary: () => '2 feeds degraded (cyber, maritime)' }),
    });
    assert.match(s.generate().feedHealthSummary, /2 feeds degraded/);
  });

  it('sources that throw are treated as empty (gracefully degrades)', () => {
    const s = new OperatorShiftReportService({
      now: () => NOW,
      sources: {
        getPulse: () => { throw new Error('upstream down'); },
        getNarrative: () => { throw new Error('upstream down'); },
        getTopSituations: () => { throw new Error('upstream down'); },
        getRecentAnomalyCount: () => { throw new Error('upstream down'); },
        getFeedHealthSummary: () => { throw new Error('upstream down'); },
      },
    });
    const r = s.generate();
    assert.equal(r.civilizationScore, null);
    assert.equal(r.civilizationLabel, null);
    assert.deepEqual(r.topSituations, []);
    assert.equal(r.anomalyCount, 0);
  });
});

// ── keyDevelopments + recommendedActions ────────────────────────────

describe('OperatorShiftReportService — keyDevelopments + recommendedActions', () => {
  beforeEach(() => { resetForTests(); });

  it('keyDevelopments populated when there are situations and a pulse', () => {
    const s = new OperatorShiftReportService({
      now: () => NOW,
      sources: emptySources({
        getPulse: () => ({ overallScore: 45, label: 'stressed' }),
        getTopSituations: () => [
          makeSituation({ id: 'sit-1', severity: 'critical', title: 'Hurricane Yara' }),
          makeSituation({ id: 'sit-2', severity: 'high', title: 'CVE-2026-9999 exploited' }),
        ],
        getRecentAnomalyCount: () => 3,
      }),
    });
    const r = s.generate();
    assert.ok(r.keyDevelopments.length >= 1);
    assert.ok(r.keyDevelopments.length <= 5);
    assert.ok(r.keyDevelopments.some((d) => /pulse|stressed|45/i.test(d)));
  });

  it('recommendedActions populated with 2-3 entries when conditions warrant', () => {
    const s = new OperatorShiftReportService({
      now: () => NOW,
      sources: emptySources({
        getPulse: () => ({ overallScore: 20, label: 'critical' }),
        getTopSituations: () => [
          makeSituation({ id: 'sit-1', severity: 'critical', title: 'Hurricane Yara' }),
        ],
        getRecentAnomalyCount: () => 8,
      }),
    });
    const r = s.generate();
    assert.ok(r.recommendedActions.length >= 1);
    assert.ok(r.recommendedActions.length <= 3);
  });

  it('quiet shift produces minimal keyDevelopments + a "monitor" action', () => {
    const s = new OperatorShiftReportService({ now: () => NOW, sources: emptySources() });
    const r = s.generate();
    assert.ok(r.keyDevelopments.length >= 1);
    assert.match(r.keyDevelopments.join(' '), /quiet|nominal|no notable/i);
    assert.ok(r.recommendedActions.some((a) => /monitor|continue/i.test(a)));
  });

  it('keyDevelopments include critical-situation titles', () => {
    const s = new OperatorShiftReportService({
      now: () => NOW,
      sources: emptySources({
        getTopSituations: () => [
          makeSituation({ id: 'sit-crit', severity: 'critical', title: 'M7.8 quake near Sendai' }),
        ],
      }),
    });
    const r = s.generate();
    assert.ok(r.keyDevelopments.some((d) => /Sendai/.test(d)));
  });
});

// ── reportText format ───────────────────────────────────────────────

describe('OperatorShiftReportService — reportText format', () => {
  beforeEach(() => { resetForTests(); });

  it('contains header with period + generatedAt', () => {
    const s = new OperatorShiftReportService({ now: () => utcHourEpoch(14), sources: emptySources() });
    const r = s.generate();
    assert.match(r.reportText, /afternoon/i);
    assert.match(r.reportText, /2026/);
  });

  it('contains section headers: Overview, Key Developments, Recommended Actions, Handoff', () => {
    const s = new OperatorShiftReportService({ now: () => NOW, sources: emptySources() });
    const text = s.generate('handoff text').reportText;
    assert.match(text, /Overview/i);
    assert.match(text, /Key Developments/i);
    assert.match(text, /Recommended Actions/i);
    assert.match(text, /Handoff/i);
  });

  it('handoff text appears in the report body when supplied', () => {
    const s = new OperatorShiftReportService({ now: () => NOW, sources: emptySources() });
    const r = s.generate('Watch for biosurv spike at 02:00Z');
    assert.match(r.reportText, /biosurv spike at 02:00Z/);
  });
});

// ── Accessors ───────────────────────────────────────────────────────

describe('OperatorShiftReportService — accessors', () => {
  beforeEach(() => { resetForTests(); });

  it('getLatest returns null before any report', () => {
    const s = new OperatorShiftReportService({ now: () => NOW, sources: emptySources() });
    assert.equal(s.getLatest(), null);
  });

  it('getLatest returns the most recently generated report', () => {
    let t = NOW;
    const s = new OperatorShiftReportService({ now: () => t, sources: emptySources() });
    s.generate('first');
    t += 60_000;
    s.generate('second');
    assert.equal(s.getLatest()?.handoffNotes, 'second');
  });

  it('getReports returns LIFO order', () => {
    let t = NOW;
    const s = new OperatorShiftReportService({ now: () => t, sources: emptySources() });
    s.generate('first');
    t += 60_000;
    s.generate('second');
    const reports = s.getReports();
    assert.equal(reports[0]?.handoffNotes, 'second');
    assert.equal(reports[1]?.handoffNotes, 'first');
  });

  it('getReports honors limit', () => {
    let t = NOW;
    const s = new OperatorShiftReportService({ now: () => t, sources: emptySources() });
    for (let i = 0; i < 5; i++) {
      s.generate(`note-${i}`);
      t += 60_000;
    }
    assert.equal(s.getReports(3).length, 3);
  });
});

// ── Subscribe ───────────────────────────────────────────────────────

describe('OperatorShiftReportService — subscribe', () => {
  beforeEach(() => { resetForTests(); });

  it('subscribe fires on every generate', () => {
    const s = new OperatorShiftReportService({ now: () => NOW, sources: emptySources() });
    let calls = 0;
    let last: ShiftReport | null = null;
    s.subscribe((r) => { calls++; last = r; });
    s.generate('first');
    s.generate('second');
    assert.equal(calls, 2);
    assert.equal(last?.handoffNotes, 'second');
  });

  it('unsubscribe stops further callbacks', () => {
    const s = new OperatorShiftReportService({ now: () => NOW, sources: emptySources() });
    let calls = 0;
    const cb = (): void => { calls++; };
    s.subscribe(cb);
    s.generate();
    s.unsubscribe(cb);
    s.generate();
    assert.equal(calls, 1);
  });

  it('subscribe disposer also unsubscribes', () => {
    const s = new OperatorShiftReportService({ now: () => NOW, sources: emptySources() });
    let calls = 0;
    const off = s.subscribe(() => { calls++; });
    s.generate();
    off();
    s.generate();
    assert.equal(calls, 1);
  });
});

// ── Persistence + ring buffer ───────────────────────────────────────

describe('OperatorShiftReportService — persistence', () => {
  beforeEach(() => { resetForTests(); });

  it('persists to and restores from a storage seam', () => {
    const fakeStorage: Record<string, string> = {};
    const storage = {
      getItem: (k: string) => fakeStorage[k] ?? null,
      setItem: (k: string, v: string) => { fakeStorage[k] = v; },
    };
    const a = new OperatorShiftReportService({ now: () => NOW, sources: emptySources(), storage });
    a.generate('persisted note');
    const b = new OperatorShiftReportService({ now: () => NOW, sources: emptySources(), storage });
    assert.equal(b.getReports().length, 1);
    assert.equal(b.getReports()[0]?.handoffNotes, 'persisted note');
  });

  it('ring buffer caps reports at supplied capacity', () => {
    let t = NOW;
    const s = new OperatorShiftReportService({ now: () => t, sources: emptySources(), capacity: 3 });
    for (let i = 0; i < 6; i++) {
      s.generate(`note-${i}`);
      t += 60_000;
    }
    assert.equal(s.getReports().length, 3);
  });

  it('corrupted storage falls back to empty', () => {
    const storage = { getItem: () => '{not-json', setItem: () => {} };
    const s = new OperatorShiftReportService({ now: () => NOW, sources: emptySources(), storage });
    assert.equal(s.getReports().length, 0);
    assert.equal(s.getLatest(), null);
  });
});
