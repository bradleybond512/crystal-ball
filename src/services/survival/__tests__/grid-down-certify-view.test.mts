import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildGridDownBoardView } from '../grid-down-certify-view.ts';
import type {
  GridDownCertification,
  GridDownAxisVerdict,
} from '../grid-down-certify.ts';

function verdict(over: Partial<GridDownAxisVerdict> = {}): GridDownAxisVerdict {
  const status = over.status ?? 'ready';
  return {
    axis: over.axis ?? 'physical_safety',
    status,
    level: over.level ?? 10,
    dataAgeMs: over.dataAgeMs ?? 0,
    readable: over.readable ?? status !== 'blind',
    stale: over.stale ?? false,
    needsGuidance: over.needsGuidance ?? false,
    hasGuidance: over.hasGuidance ?? true,
    reason: over.reason ?? 'test reason',
  };
}

function cert(over: Partial<GridDownCertification> = {}): GridDownCertification {
  const axisVerdicts = over.axisVerdicts ?? [verdict()];
  const blindAxes = over.blindAxes ?? axisVerdicts.filter((v) => v.status === 'blind').map((v) => v.axis);
  const guidanceGapAxes =
    over.guidanceGapAxes ??
    axisVerdicts.filter((v) => v.needsGuidance && !v.hasGuidance && v.readable).map((v) => v.axis);
  const staleAxes =
    over.staleAxes ?? axisVerdicts.filter((v) => v.readable && v.stale && v.status !== 'blind').map((v) => v.axis);
  const certified = over.certified ?? (blindAxes.length === 0 && guidanceGapAxes.length === 0);
  return {
    capturedAtMs: over.capturedAtMs ?? 0,
    now: over.now ?? 0,
    axisVerdicts,
    blindAxes,
    guidanceGapAxes,
    staleAxes,
    certified,
    headline: over.headline ?? 'test headline',
  };
}

test('title is the constant board title', () => {
  assert.equal(buildGridDownBoardView(cert()).title, 'Can you run offline?');
});

test('headline and certified are passed through', () => {
  const view = buildGridDownBoardView(cert({ headline: 'Grid-down certified.', certified: true }));
  assert.equal(view.headline, 'Grid-down certified.');
  assert.equal(view.certified, true);
});

test('row statusLabel: blind / degraded / ready', () => {
  const view = buildGridDownBoardView(
    cert({
      axisVerdicts: [
        verdict({ axis: 'comms', status: 'blind', readable: false }),
        verdict({ axis: 'supply', status: 'degraded', stale: true }),
        verdict({ axis: 'health', status: 'ready' }),
      ],
    }),
  );
  const byAxis = Object.fromEntries(view.rows.map((r) => [r.axis, r.statusLabel]));
  assert.equal(byAxis.comms, 'Blind');
  assert.equal(byAxis.supply, 'Degraded');
  assert.equal(byAxis.health, 'Ready');
});

test('row tone follows offline status, not threat band — a ready critical axis is neutral', () => {
  const view = buildGridDownBoardView(
    cert({ axisVerdicts: [verdict({ axis: 'financial', status: 'ready', level: 92 })] }),
  );
  assert.equal(view.rows[0]!.band, 'critical');
  assert.equal(view.rows[0]!.tone, 'neutral');
});

test('rows sort worst-first: blind before degraded before ready', () => {
  const view = buildGridDownBoardView(
    cert({
      axisVerdicts: [
        verdict({ axis: 'health', status: 'ready' }),
        verdict({ axis: 'comms', status: 'blind', readable: false }),
        verdict({ axis: 'supply', status: 'degraded', stale: true }),
      ],
    }),
  );
  assert.deepEqual(view.rows.map((r) => r.status), ['blind', 'degraded', 'ready']);
});

test('within the same status, the higher-band axis leads', () => {
  const view = buildGridDownBoardView(
    cert({
      axisVerdicts: [
        verdict({ axis: 'supply', status: 'degraded', level: 45, stale: true }),
        verdict({ axis: 'financial', status: 'degraded', level: 85, stale: true }),
      ],
    }),
  );
  assert.deepEqual(view.rows.map((r) => r.axis), ['financial', 'supply']);
});

test('card tone: a blind axis makes the card danger', () => {
  const view = buildGridDownBoardView(
    cert({ axisVerdicts: [verdict({ axis: 'comms', status: 'blind', readable: false })] }),
  );
  assert.equal(view.tone, 'danger');
});

test('card tone: a guidance gap alone makes the card caution', () => {
  const view = buildGridDownBoardView(
    cert({
      axisVerdicts: [
        verdict({ axis: 'supply', status: 'degraded', level: 60, needsGuidance: true, hasGuidance: false }),
      ],
    }),
  );
  assert.equal(view.tone, 'caution');
});

test('card tone: certified but stale is muted', () => {
  const view = buildGridDownBoardView(
    cert({ axisVerdicts: [verdict({ axis: 'health', status: 'degraded', stale: true })] }),
  );
  assert.equal(view.certified, true);
  assert.equal(view.tone, 'muted');
});

test('card tone: a clean certification is neutral', () => {
  const view = buildGridDownBoardView(cert({ axisVerdicts: [verdict({ status: 'ready' })] }));
  assert.equal(view.tone, 'neutral');
});

test('ageLabel: 0 → fresh, under an hour → "under 1h", hours → "Nh old"', () => {
  const view = buildGridDownBoardView(
    cert({
      axisVerdicts: [
        verdict({ axis: 'comms', dataAgeMs: 0 }),
        verdict({ axis: 'supply', dataAgeMs: 30 * 60_000 }),
        verdict({ axis: 'health', dataAgeMs: 12 * 3_600_000 }),
      ],
    }),
  );
  const byAxis = Object.fromEntries(view.rows.map((r) => [r.axis, r.ageLabel]));
  assert.equal(byAxis.comms, 'fresh');
  assert.equal(byAxis.supply, 'under 1h');
  assert.equal(byAxis.health, '12h old');
});

test('bucket counts come straight from the certification', () => {
  const view = buildGridDownBoardView(
    cert({
      axisVerdicts: [
        verdict({ axis: 'comms', status: 'blind', readable: false }),
        verdict({ axis: 'supply', status: 'degraded', level: 60, needsGuidance: true, hasGuidance: false }),
        verdict({ axis: 'health', status: 'degraded', stale: true }),
        verdict({ axis: 'financial', status: 'ready' }),
      ],
    }),
  );
  assert.equal(view.blindCount, 1);
  assert.equal(view.guidanceGapCount, 1);
  assert.equal(view.staleCount, 1);
  assert.equal(view.readyCount, 1);
});

test('counts reflect the whole certification even when rows are capped', () => {
  const view = buildGridDownBoardView(
    cert({
      axisVerdicts: [
        verdict({ axis: 'comms', status: 'blind', readable: false }),
        verdict({ axis: 'supply', status: 'blind', readable: false }),
        verdict({ axis: 'health', status: 'ready' }),
      ],
    }),
    { maxRows: 1 },
  );
  assert.equal(view.rows.length, 1);
  assert.equal(view.blindCount, 2);
});

test('maxRows caps rows and reports overflow', () => {
  const axes = ['physical_safety', 'supply', 'comms', 'health', 'financial'] as const;
  const view = buildGridDownBoardView(
    cert({ axisVerdicts: axes.map((axis) => verdict({ axis, status: 'ready' })) }),
    { maxRows: 2 },
  );
  assert.equal(view.rows.length, 2);
  assert.equal(view.rowOverflow, 3);
  assert.equal(view.rowOverflowLabel, '+3 more');
});

test('default cap of 8 shows a full eight-axis certification with no overflow', () => {
  const axes = [
    'physical_safety', 'supply', 'financial', 'mobility', 'comms', 'health', 'energy_water', 'security',
  ] as const;
  const view = buildGridDownBoardView(cert({ axisVerdicts: axes.map((axis) => verdict({ axis })) }));
  assert.equal(view.rows.length, 8);
  assert.equal(view.rowOverflow, 0);
  assert.equal(view.rowOverflowLabel, '');
});

test('non-positive maxRows is floored to 1 and keeps the single worst axis', () => {
  const view = buildGridDownBoardView(
    cert({
      axisVerdicts: [
        verdict({ axis: 'health', status: 'ready' }),
        verdict({ axis: 'comms', status: 'blind', readable: false }),
      ],
    }),
    { maxRows: 0 },
  );
  assert.equal(view.rows.length, 1);
  assert.equal(view.rows[0]!.status, 'blind');
  assert.equal(view.rowOverflow, 1);
});

test('statusSummary is a compact count line', () => {
  const view = buildGridDownBoardView(
    cert({
      axisVerdicts: [
        verdict({ axis: 'comms', status: 'blind', readable: false }),
        verdict({ axis: 'supply', status: 'degraded', stale: true }),
        verdict({ axis: 'health', status: 'ready' }),
      ],
    }),
  );
  assert.equal(view.statusSummary, '1 ready · 1 degraded · 1 blind');
});

test('band is derived from the level and reason is carried verbatim', () => {
  const view = buildGridDownBoardView(
    cert({ axisVerdicts: [verdict({ axis: 'supply', level: 71, reason: 'Supply renders offline.' })] }),
  );
  assert.equal(view.rows[0]!.band, 'high');
  assert.equal(view.rows[0]!.reason, 'Supply renders offline.');
});

test('row carries the stale / needsGuidance / hasGuidance flags', () => {
  const view = buildGridDownBoardView(
    cert({
      axisVerdicts: [
        verdict({ axis: 'supply', status: 'degraded', level: 60, stale: true, needsGuidance: true, hasGuidance: false }),
      ],
    }),
  );
  const row = view.rows[0]!;
  assert.equal(row.stale, true);
  assert.equal(row.needsGuidance, true);
  assert.equal(row.hasGuidance, false);
});

test('isEmpty is true only for an empty certification', () => {
  assert.equal(buildGridDownBoardView(cert()).isEmpty, false);
  assert.equal(buildGridDownBoardView(cert({ axisVerdicts: [] })).isEmpty, true);
});
