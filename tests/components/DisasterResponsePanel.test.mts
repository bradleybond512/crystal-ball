/**
 * DisasterResponsePanel — pure-helper tests.
 *
 * Imports only the sibling helpers module so the test runner doesn't
 * pull in `Panel` (which transitively loads Vite-only syntax).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  PHASE_COLOR,
  SEVERITY_COLOR,
  SEVERITY_LABEL,
  STATUS_COLOR,
  buildDisasterResponseState,
  buildEffectivenessIndex,
  coordinationScore,
  coverageScore,
  effectivenessColor,
  effectivenessFor,
  effectivenessTier,
  formatQuantity,
  formatUsdMillions,
  parseAccessCorridors,
  parseCoordinationGaps,
  parseDisasterOperations,
  parseResources,
  renderAccessLogistics,
  renderActiveOperations,
  renderCoordinationGaps,
  renderEffectivenessIndex,
  renderResourceDeployment,
  speedScore,
  type AccessCorridor,
  type CoordinationGap,
  type DisasterOperation,
} from '../../src/components/disaster-response-helpers.ts';
import type { ObservationEvent, ObservationSeverity } from '../../src/types/intelligence.ts';

const NOW = 1_780_000_000_000;

// ── Fixture builders ──────────────────────────────────────────────────

function ev(over: Partial<ObservationEvent> & { raw?: Record<string, unknown> } = {}): ObservationEvent {
  return {
    id: over.id ?? 'e1',
    sourceId: 'unhcr',
    domain: 'disaster',
    timestamp: NOW,
    severity: (over.severity ?? 'MEDIUM') as ObservationSeverity,
    title: over.title ?? 'event',
    raw: over.raw ?? {},
    entityIds: over.entityIds ?? [],
    tags: over.tags ?? [],
  };
}

function operationEvent(over: Partial<ObservationEvent> & { raw?: Record<string, unknown> } = {}): ObservationEvent {
  return ev({
    ...over,
    raw: { kind: 'operation', ...(over.raw ?? {}) },
  });
}

function resourceEvent(over: Partial<ObservationEvent> & { raw?: Record<string, unknown> } = {}): ObservationEvent {
  return ev({
    ...over,
    raw: { kind: 'resource', ...(over.raw ?? {}) },
  });
}

function corridorEvent(over: Partial<ObservationEvent> & { raw?: Record<string, unknown> } = {}): ObservationEvent {
  return ev({
    ...over,
    raw: { kind: 'corridor', ...(over.raw ?? {}) },
  });
}

function gapEvent(over: Partial<ObservationEvent> & { raw?: Record<string, unknown> } = {}): ObservationEvent {
  return ev({
    ...over,
    raw: { kind: 'gap', ...(over.raw ?? {}) },
  });
}

// ── parseDisasterOperations ──────────────────────────────────────────

describe('parseDisasterOperations', () => {
  it('ignores events whose raw.kind is not "operation"', () => {
    const ops = parseDisasterOperations([
      resourceEvent(),
      corridorEvent(),
      gapEvent(),
    ]);
    assert.equal(ops.length, 0);
  });

  it('returns one operation per matching event', () => {
    const ops = parseDisasterOperations([
      operationEvent({ id: 'op-1' }),
      operationEvent({ id: 'op-2' }),
    ]);
    assert.equal(ops.length, 2);
  });

  it('maps disasterType to the typed enum', () => {
    const ops = parseDisasterOperations([
      operationEvent({ raw: { kind: 'operation', disasterType: 'earthquake' } }),
      operationEvent({ id: 'flood', raw: { kind: 'operation', disasterType: 'flood' } }),
      operationEvent({ id: 'unk', raw: { kind: 'operation', disasterType: 'mystery' } }),
    ]);
    assert.equal(ops[0]?.type, 'earthquake');
    assert.equal(ops[1]?.type, 'flood');
    assert.equal(ops[2]?.type, 'other');
  });

  it('defaults phase to relief for unknown values', () => {
    const ops = parseDisasterOperations([
      operationEvent({ raw: { kind: 'operation', phase: 'gibberish' } }),
    ]);
    assert.equal(ops[0]?.phase, 'relief');
  });

  it('sorts highest-severity first, then most recent', () => {
    const ops = parseDisasterOperations([
      operationEvent({ id: 'a', severity: 'MEDIUM', timestamp: NOW - 1000 }),
      operationEvent({ id: 'b', severity: 'CRITICAL', timestamp: NOW - 2000 }),
      operationEvent({ id: 'c', severity: 'HIGH', timestamp: NOW }),
    ]);
    assert.equal(ops[0]?.id, 'b');
    assert.equal(ops[1]?.id, 'c');
    assert.equal(ops[2]?.id, 'a');
  });

  it('falls back to event id/title when raw lacks operationId/operationName', () => {
    const ops = parseDisasterOperations([
      operationEvent({ id: 'evt-7', title: 'Tropical Storm Alpha', raw: { kind: 'operation' } }),
    ]);
    assert.equal(ops[0]?.id, 'evt-7');
    assert.equal(ops[0]?.name, 'Tropical Storm Alpha');
  });
});

// ── parseResources ───────────────────────────────────────────────────

describe('parseResources', () => {
  it('parses canonical resource events', () => {
    const r = parseResources([
      resourceEvent({ raw: { kind: 'resource', organization: 'WFP', resourceKind: 'food', quantity: 12000, unit: 'metric tons', destination: 'Khartoum', status: 'in-transit' } }),
    ]);
    assert.equal(r.length, 1);
    assert.equal(r[0]?.organization, 'WFP');
    assert.equal(r[0]?.kind, 'food');
    assert.equal(r[0]?.quantity, 12000);
    assert.equal(r[0]?.status, 'in-transit');
  });

  it('normalises search-rescue spellings (search_rescue / sar)', () => {
    const r = parseResources([
      resourceEvent({ id: 'a', raw: { kind: 'resource', resourceKind: 'search_rescue' } }),
      resourceEvent({ id: 'b', raw: { kind: 'resource', resourceKind: 'sar' } }),
    ]);
    assert.equal(r[0]?.kind, 'search-rescue');
    assert.equal(r[1]?.kind, 'search-rescue');
  });

  it('clamps negative quantities to 0', () => {
    const r = parseResources([
      resourceEvent({ raw: { kind: 'resource', quantity: -10 } }),
    ]);
    assert.equal(r[0]?.quantity, 0);
  });
});

// ── parseAccessCorridors ─────────────────────────────────────────────

describe('parseAccessCorridors', () => {
  it('clamps populationReachedPct to 0..100', () => {
    const c = parseAccessCorridors([
      corridorEvent({ id: 'lo', raw: { kind: 'corridor', populationReachedPct: -5 } }),
      corridorEvent({ id: 'hi', raw: { kind: 'corridor', populationReachedPct: 200 } }),
    ]);
    assert.equal(c[0]?.populationReachedPct, 0);
    assert.equal(c[1]?.populationReachedPct, 100);
  });

  it('defaults bottleneck to "none" when unknown', () => {
    const c = parseAccessCorridors([
      corridorEvent({ raw: { kind: 'corridor', bottleneck: 'mystery' } }),
    ]);
    assert.equal(c[0]?.bottleneck, 'none');
  });

  it('defaults status to "limited" when neither open nor blocked', () => {
    const c = parseAccessCorridors([
      corridorEvent({ raw: { kind: 'corridor' } }),
    ]);
    assert.equal(c[0]?.status, 'limited');
  });
});

// ── parseCoordinationGaps ────────────────────────────────────────────

describe('parseCoordinationGaps', () => {
  it('normalises sector to the typed enum (WASH stays uppercase)', () => {
    const g = parseCoordinationGaps([
      gapEvent({ raw: { kind: 'gap', sector: 'wash' } }),
      gapEvent({ id: 'health', raw: { kind: 'gap', sector: 'health' } }),
    ]);
    assert.equal(g[0]?.sector, 'WASH');
    assert.equal(g[1]?.sector, 'health');
  });

  it('sorts highest-severity first', () => {
    const g = parseCoordinationGaps([
      gapEvent({ id: 'a', severity: 'LOW' }),
      gapEvent({ id: 'b', severity: 'CRITICAL' }),
      gapEvent({ id: 'c', severity: 'HIGH' }),
    ]);
    assert.equal(g[0]?.id, 'b');
    assert.equal(g[1]?.id, 'c');
    assert.equal(g[2]?.id, 'a');
  });

  it('clamps unfundedUsdMillions ≥0', () => {
    const g = parseCoordinationGaps([
      gapEvent({ raw: { kind: 'gap', unfundedUsdMillions: -50 } }),
    ]);
    assert.equal(g[0]?.unfundedUsdMillions, 0);
  });
});

// ── coverage / speed / coordination scoring ──────────────────────────

describe('coverageScore', () => {
  function corridor(over: Partial<AccessCorridor> = {}): AccessCorridor {
    return {
      id: 'c1',
      name: 'Highway 1',
      status: 'limited',
      bottleneck: 'security',
      populationReachedPct: 50,
      ...over,
    };
  }
  function op(over: Partial<DisasterOperation> = {}): DisasterOperation {
    return {
      id: 'op',
      name: 'Op',
      type: 'earthquake',
      region: 'North',
      phase: 'relief',
      leadAgency: 'OCHA',
      severity: 3,
      startedAt: NOW,
      ...over,
    };
  }

  it('returns 0 when no corridors are available', () => {
    assert.equal(coverageScore(op(), []), 0);
  });

  it('averages all corridors when none match the operation region', () => {
    const s = coverageScore(op({ region: 'unrelated' }), [
      corridor({ populationReachedPct: 40 }),
      corridor({ populationReachedPct: 80 }),
    ]);
    assert.equal(s, 60);
  });

  it('prefers corridors whose name matches the operation region', () => {
    const s = coverageScore(op({ region: 'Sahel' }), [
      corridor({ name: 'Sahel north corridor', populationReachedPct: 90 }),
      corridor({ name: 'Other route', populationReachedPct: 10 }),
    ]);
    assert.equal(s, 90);
  });
});

describe('speedScore', () => {
  it('assessment=33, relief=66, recovery=100', () => {
    assert.equal(speedScore({ id: 'x', name: '', type: 'flood', region: '', phase: 'assessment', leadAgency: '', severity: 2, startedAt: NOW }), 33);
    assert.equal(speedScore({ id: 'x', name: '', type: 'flood', region: '', phase: 'relief', leadAgency: '', severity: 2, startedAt: NOW }), 66);
    assert.equal(speedScore({ id: 'x', name: '', type: 'flood', region: '', phase: 'recovery', leadAgency: '', severity: 2, startedAt: NOW }), 100);
  });
});

describe('coordinationScore', () => {
  function gap(severity: 0 | 1 | 2 | 3 | 4): CoordinationGap {
    return { id: 'g', sector: 'health', gapSeverity: severity, responsibleCluster: 'Health', unfundedUsdMillions: 0, summary: '' };
  }
  it('returns 100 when no high/critical gaps', () => {
    assert.equal(coordinationScore([gap(1), gap(2)]), 100);
  });
  it('subtracts 12 per HIGH or CRITICAL gap', () => {
    assert.equal(coordinationScore([gap(3), gap(4)]), 76);
  });
  it('caps at 0 when many critical gaps', () => {
    assert.equal(coordinationScore([gap(4), gap(4), gap(4), gap(4), gap(4), gap(4), gap(4), gap(4), gap(4)]), 0);
  });
});

// ── effectivenessFor ─────────────────────────────────────────────────

describe('effectivenessFor', () => {
  it('produces a composite of 0.5*coverage + 0.25*speed + 0.25*coordination', () => {
    const op: DisasterOperation = {
      id: 'op', name: 'Op', type: 'flood', region: 'X', phase: 'relief',
      leadAgency: 'OCHA', severity: 3, startedAt: NOW,
    };
    const corridors: AccessCorridor[] = [{
      id: 'c', name: 'X corridor', status: 'limited', bottleneck: 'security', populationReachedPct: 80,
    }];
    const gaps: CoordinationGap[] = [];
    const e = effectivenessFor(op, corridors, gaps);
    assert.equal(e.coverage, 80);
    assert.equal(e.speed, 66);
    assert.equal(e.coordination, 100);
    // 0.5*80 + 0.25*66 + 0.25*100 = 40 + 16.5 + 25 = 81.5 → 82
    assert.equal(e.score, 82);
  });

  it('carries operationId + operationName through to the score', () => {
    const op: DisasterOperation = {
      id: 'op-7', name: 'Op Sahel', type: 'famine', region: '', phase: 'assessment',
      leadAgency: '', severity: 4, startedAt: NOW,
    };
    const e = effectivenessFor(op, [], []);
    assert.equal(e.operationId, 'op-7');
    assert.equal(e.operationName, 'Op Sahel');
  });
});

describe('effectivenessColor + effectivenessTier', () => {
  it('70+ → strong (green)', () => {
    assert.equal(effectivenessTier(70), 'strong');
    assert.equal(effectivenessColor(70), '#4ade80');
  });
  it('50..69 → adequate (yellow)', () => {
    assert.equal(effectivenessTier(60), 'adequate');
    assert.equal(effectivenessColor(60), '#facc15');
  });
  it('30..49 → strained (orange)', () => {
    assert.equal(effectivenessTier(35), 'strained');
    assert.equal(effectivenessColor(35), '#fb923c');
  });
  it('<30 → failing (red)', () => {
    assert.equal(effectivenessTier(10), 'failing');
    assert.equal(effectivenessColor(10), '#ef4444');
  });
});

// ── buildEffectivenessIndex ──────────────────────────────────────────

describe('buildEffectivenessIndex', () => {
  it('produces one score per operation', () => {
    const ops: DisasterOperation[] = [
      { id: 'a', name: 'A', type: 'flood', region: '', phase: 'relief', leadAgency: '', severity: 2, startedAt: NOW },
      { id: 'b', name: 'B', type: 'flood', region: '', phase: 'recovery', leadAgency: '', severity: 2, startedAt: NOW },
    ];
    const idx = buildEffectivenessIndex(ops, [], []);
    assert.equal(idx.length, 2);
    assert.equal(idx[0]?.operationId, 'a');
    assert.equal(idx[1]?.operationId, 'b');
  });
});

// ── Format helpers ───────────────────────────────────────────────────

describe('formatUsdMillions', () => {
  it('renders billions with B suffix', () => assert.equal(formatUsdMillions(1500), '$1.5B'));
  it('renders millions with M suffix', () => assert.equal(formatUsdMillions(42), '$42M'));
  it('renders sub-million as <$1M placeholder', () => assert.equal(formatUsdMillions(0.5), '<$1M'));
});

describe('formatQuantity', () => {
  it('renders millions with M suffix', () => assert.equal(formatQuantity(1_500_000, 'kits'), '1.5M kits'));
  it('renders thousands with k suffix', () => assert.equal(formatQuantity(2500, 'kits'), '2.5k kits'));
  it('renders sub-thousand as raw number + unit', () => assert.equal(formatQuantity(500, 'kits'), '500 kits'));
});

// ── Color tables ─────────────────────────────────────────────────────

describe('SEVERITY_COLOR + SEVERITY_LABEL', () => {
  it('cover all five severity scores', () => {
    for (const s of [0, 1, 2, 3, 4] as const) {
      assert.ok(SEVERITY_COLOR[s]);
      assert.ok(SEVERITY_LABEL[s]);
    }
  });
  it('CRITICAL is the red signal', () => {
    assert.equal(SEVERITY_COLOR[4], '#ef4444');
    assert.equal(SEVERITY_LABEL[4], 'CRITICAL');
  });
});

describe('PHASE_COLOR + STATUS_COLOR', () => {
  it('PHASE_COLOR has all three response phases', () => {
    assert.ok(PHASE_COLOR.assessment && PHASE_COLOR.relief && PHASE_COLOR.recovery);
  });
  it('STATUS_COLOR has all three corridor statuses', () => {
    assert.ok(STATUS_COLOR.open && STATUS_COLOR.limited && STATUS_COLOR.blocked);
  });
});

// ── Section renderers ────────────────────────────────────────────────

describe('renderActiveOperations', () => {
  it('renders empty-state when no operations', () => {
    const html = renderActiveOperations([]);
    assert.match(html, /No active disaster operations/);
  });
  it('escapes XSS in operation name', () => {
    const html = renderActiveOperations([
      { id: 'o', name: '<script>x</script>', type: 'flood', region: 'X', phase: 'relief', leadAgency: 'OCHA', severity: 3, startedAt: NOW },
    ]);
    assert.ok(!html.includes('<script>x</script>'));
    assert.match(html, /&lt;script&gt;/);
  });
  it('shows severity label as a badge', () => {
    const html = renderActiveOperations([
      { id: 'o', name: 'Op', type: 'flood', region: 'X', phase: 'relief', leadAgency: 'OCHA', severity: 4, startedAt: NOW },
    ]);
    assert.match(html, /CRITICAL/);
  });
});

describe('renderResourceDeployment', () => {
  it('renders empty-state when no resources', () => {
    assert.match(renderResourceDeployment([]), /No deployed resources/);
  });
  it('shows quantity + unit + destination', () => {
    const html = renderResourceDeployment([
      { id: 'r', organization: 'WFP', kind: 'food', quantity: 12000, unit: 'metric tons', destination: 'Khartoum', status: 'in-transit' },
    ]);
    assert.match(html, /12\.0k metric tons/);
    assert.match(html, /Khartoum/);
  });
});

describe('renderAccessLogistics', () => {
  it('renders empty-state when no corridors', () => {
    assert.match(renderAccessLogistics([]), /No corridor data/);
  });
  it('shows percentage reached with severity color', () => {
    const html = renderAccessLogistics([
      { id: 'c', name: 'Hwy 1', status: 'limited', bottleneck: 'security', populationReachedPct: 85 },
    ]);
    assert.match(html, /85%/);
  });
});

describe('renderCoordinationGaps', () => {
  it('renders empty-state when no gaps', () => {
    assert.match(renderCoordinationGaps([]), /No coordination gaps/);
  });
  it('shows responsible cluster + unfunded amount', () => {
    const html = renderCoordinationGaps([
      { id: 'g', sector: 'health', gapSeverity: 3, responsibleCluster: 'Health Cluster', unfundedUsdMillions: 25, summary: 'medical supply shortfall' },
    ]);
    assert.match(html, /Health Cluster/);
    assert.match(html, /\$25M/);
    assert.match(html, /medical supply shortfall/);
  });
});

describe('renderEffectivenessIndex', () => {
  it('renders empty-state when no scores', () => {
    assert.match(renderEffectivenessIndex([]), /No operations to score/);
  });
  it('shows the per-operation tier label', () => {
    const html = renderEffectivenessIndex([
      { operationId: 'a', operationName: 'Alpha', score: 82, coverage: 80, speed: 66, coordination: 100 },
    ]);
    assert.match(html, /strong/i);
    assert.match(html, /Alpha/);
    assert.match(html, /\b82\b/);
  });
});

// ── buildDisasterResponseState integration ───────────────────────────

describe('buildDisasterResponseState', () => {
  it('returns empty state for empty input', () => {
    const s = buildDisasterResponseState([], NOW);
    assert.equal(s.operations.length, 0);
    assert.equal(s.resources.length, 0);
    assert.equal(s.corridors.length, 0);
    assert.equal(s.gaps.length, 0);
    assert.equal(s.effectiveness.length, 0);
    assert.equal(s.generatedAt, NOW);
  });

  it('builds an end-to-end state from mixed events', () => {
    const events: ObservationEvent[] = [
      operationEvent({ id: 'op-1', severity: 'CRITICAL', raw: { kind: 'operation', operationName: 'Op Sahel', disasterType: 'famine', region: 'Sahel', phase: 'relief', leadAgency: 'OCHA' } }),
      resourceEvent({ id: 'r-1', raw: { kind: 'resource', organization: 'WFP', resourceKind: 'food', quantity: 12000, unit: 'metric tons', destination: 'Sahel', status: 'in-transit' } }),
      corridorEvent({ id: 'c-1', raw: { kind: 'corridor', corridorName: 'Sahel north corridor', status: 'limited', bottleneck: 'security', populationReachedPct: 75 } }),
      gapEvent({ id: 'g-1', severity: 'HIGH', raw: { kind: 'gap', sector: 'health', responsibleCluster: 'Health Cluster', unfundedUsdMillions: 30, gapSummary: 'medical shortfall' } }),
    ];
    const s = buildDisasterResponseState(events, NOW);
    assert.equal(s.operations.length, 1);
    assert.equal(s.resources.length, 1);
    assert.equal(s.corridors.length, 1);
    assert.equal(s.gaps.length, 1);
    assert.equal(s.effectiveness.length, 1);
    const e = s.effectiveness[0]!;
    // coverage 75 + speed 66 (relief) + coordination 88 (-12 for 1 HIGH gap)
    assert.equal(e.coverage, 75);
    assert.equal(e.speed, 66);
    assert.equal(e.coordination, 88);
    assert.equal(e.score, Math.round(0.5 * 75 + 0.25 * 66 + 0.25 * 88));
  });

  it('ignores events without a recognised raw.kind', () => {
    const s = buildDisasterResponseState([
      ev({ raw: { kind: 'unknown' } }),
      ev({ raw: null as unknown as Record<string, unknown> }),
    ], NOW);
    assert.equal(s.operations.length, 0);
    assert.equal(s.resources.length, 0);
    assert.equal(s.corridors.length, 0);
    assert.equal(s.gaps.length, 0);
  });
});
