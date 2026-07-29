// src/services/survival/__tests__/survival-outlook.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSurvivalOutlook, type SurvivalOutlook } from '../survival-outlook.ts';
import { renderSurvivalOutlook } from '../survival-outlook-render.ts';
import { availableMoves } from '../survival-moves.ts';
import { bandForLevel, SURVIVAL_AXES } from '../survival-types.ts';
import type {
  AxisState, DomainFreshness, PostureThreat, SurvivalAxis, SurvivalPosture, WorldSnapshot,
} from '../survival-types.ts';

const CAP = 1_700_000_000_000;

function threat(axis: SurvivalAxis, severity: number): PostureThreat {
  return {
    sourceEventId: 'e1', axis, severity, threatLevel: 'warning', hazardKind: 'tornado',
    hazardLabel: 'Tornado Warning', timeToImpactMins: 30, arrivalLabel: '30 min',
    why: 'polygon over saved place', confidenceLabel: 'high',
  };
}

function axisState(axis: SurvivalAxis, level: number, opts: { threats?: PostureThreat[]; drivers?: string[] } = {}): AxisState {
  return {
    axis, level, band: bandForLevel(level), trend: 'steady', threats: opts.threats ?? [],
    confidence: { total: level, max: 100, items: [{ label: 'x', value: level, max: 100, polarity: 'negative' }] },
    explanation: { headline: `${axis}`, lines: [], missingConfirmation: [] },
    drivers: opts.drivers ?? [],
  };
}

function posture(overrides: Partial<Record<SurvivalAxis, AxisState>> = {}): SurvivalPosture {
  const axes = SURVIVAL_AXES.map((a) => overrides[a] ?? axisState(a, 0));
  const worst = axes.reduce((m, a) => (a.level > m.level ? a : m), axes[0]!);
  return {
    axes, overallLevel: worst.level, overallBand: worst.band, worstAxis: worst.axis,
    headline: 'x', capturedAtMs: CAP, staleInputs: [],
  };
}

function snapshot(p: SurvivalPosture, freshness: DomainFreshness[] = []): WorldSnapshot {
  return { version: 1, capturedAtMs: CAP, freshness, weatherAlerts: [], savedPlaces: [], posture: p, plan: { committed: [] } };
}

/** A posture with an active severe physical-safety threat — exercises every core. */
function severePosture(): SurvivalPosture {
  return posture({
    physical_safety: axisState('physical_safety', 82, {
      threats: [threat('physical_safety', 82)],
      drivers: ['Tornado warning'],
    }),
  });
}

const BOARD_KEYS = ['trajectory', 'branches', 'decision', 'gridDown', 'offline', 'comms', 'retrospective'] as const;

test('buildSurvivalOutlook returns all seven boards with string titles', () => {
  const p = severePosture();
  const snap = snapshot(p);
  const moves = availableMoves(p, snap, { now: CAP });
  const outlook = buildSurvivalOutlook(snap, p, moves, { now: CAP });
  for (const key of BOARD_KEYS) {
    assert.ok(key in outlook, `missing board: ${key}`);
    assert.equal(typeof outlook[key].title, 'string');
    assert.ok(outlook[key].title.length > 0, `empty title: ${key}`);
    assert.equal(typeof outlook[key].isEmpty, 'boolean');
  }
});

test('retrospective is empty when no calibration history is supplied', () => {
  const p = severePosture();
  const snap = snapshot(p);
  const outlook = buildSurvivalOutlook(snap, p, [], {});
  assert.equal(outlook.retrospective.isEmpty, true);
});

test('the orchestrator is deterministic for identical inputs', () => {
  const p = severePosture();
  const snap = snapshot(p);
  const moves = availableMoves(p, snap, { now: CAP });
  const a = buildSurvivalOutlook(snap, p, moves, { now: CAP });
  const b = buildSurvivalOutlook(snap, p, moves, { now: CAP });
  assert.deepEqual(a, b);
});

test('renderSurvivalOutlook yields collapsible sections including the trajectory title', () => {
  const p = severePosture();
  const snap = snapshot(p);
  const moves = availableMoves(p, snap, { now: CAP });
  const outlook = buildSurvivalOutlook(snap, p, moves, { now: CAP });
  const html = renderSurvivalOutlook(outlook);
  assert.equal(typeof html, 'string');
  assert.ok(html.includes('<details'), 'expected collapsible sections');
  assert.ok(html.includes(outlook.trajectory.title), 'expected the trajectory board title');
});

test('an empty retrospective renders no retrospective section', () => {
  const p = severePosture();
  const snap = snapshot(p);
  const outlook = buildSurvivalOutlook(snap, p, [], {});
  assert.equal(outlook.retrospective.isEmpty, true);
  const html = renderSurvivalOutlook(outlook);
  assert.ok(!html.includes(outlook.retrospective.title), 'empty board must not render');
});

test('renderSurvivalOutlook returns empty string when every board is empty', () => {
  const p = severePosture();
  const snap = snapshot(p);
  const real = buildSurvivalOutlook(snap, p, availableMoves(p, snap, { now: CAP }), { now: CAP });
  const allEmpty: SurvivalOutlook = {
    trajectory: { ...real.trajectory, isEmpty: true },
    branches: { ...real.branches, isEmpty: true },
    decision: { ...real.decision, isEmpty: true },
    gridDown: { ...real.gridDown, isEmpty: true },
    offline: { ...real.offline, isEmpty: true },
    comms: { ...real.comms, isEmpty: true },
    retrospective: { ...real.retrospective, isEmpty: true },
  };
  assert.equal(renderSurvivalOutlook(allEmpty), '');
});

test('interpolated board text is HTML-escaped', () => {
  const p = severePosture();
  const snap = snapshot(p);
  const real = buildSurvivalOutlook(snap, p, availableMoves(p, snap, { now: CAP }), { now: CAP });
  const injected: SurvivalOutlook = {
    trajectory: { ...real.trajectory, isEmpty: false, headline: '<script>x</script>' },
    branches: { ...real.branches, isEmpty: true },
    decision: { ...real.decision, isEmpty: true },
    gridDown: { ...real.gridDown, isEmpty: true },
    offline: { ...real.offline, isEmpty: true },
    comms: { ...real.comms, isEmpty: true },
    retrospective: { ...real.retrospective, isEmpty: true },
  };
  const html = renderSurvivalOutlook(injected);
  assert.ok(!html.includes('<script>x</script>'), 'raw markup must not survive');
  assert.ok(html.includes('&lt;script&gt;x&lt;/script&gt;'), 'expected escaped markup');
});
