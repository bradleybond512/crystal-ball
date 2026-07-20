import { test } from 'node:test';
import assert from 'node:assert/strict';
import { markerStyleForLens, markerStyleForTier, buildLensStyleIndex } from '../lens-marker-style.ts';
import { lensTint } from '../personal-lens.ts';
import type { LensTier, LensView } from '../personal-lens.ts';

function view(tier: LensTier, relevance: number): LensView {
  return { eventId: 'e', relevance, tier, axis: 'physical_safety', drivers: [] };
}

test('core is opaque, large, outlined, labeled, top z, not dimmed', () => {
  const s = markerStyleForLens(view('core', 0.9));
  assert.ok(s.alpha > 0.9);
  assert.ok(s.scale >= 1.4);
  assert.equal(s.outline, true);
  assert.equal(s.showLabel, true);
  assert.equal(s.zIndex, 3);
  assert.equal(s.dimmed, false);
});

test('background fades back, shrinks, no outline/label, bottom z, dimmed', () => {
  const s = markerStyleForLens(view('background', 0.1));
  assert.ok(s.alpha < 0.35);
  assert.ok(s.scale < 0.9);
  assert.equal(s.outline, false);
  assert.equal(s.showLabel, false);
  assert.equal(s.zIndex, 0);
  assert.equal(s.dimmed, true);
});

test('elevated is outlined + labeled; ambient is neither and is dimmed', () => {
  const elevated = markerStyleForLens(view('elevated', 0.5));
  assert.equal(elevated.outline, true);
  assert.equal(elevated.showLabel, true);
  assert.equal(elevated.dimmed, false);
  const ambient = markerStyleForLens(view('ambient', 0.3));
  assert.equal(ambient.outline, false);
  assert.equal(ambient.showLabel, false);
  assert.equal(ambient.dimmed, true);
});

test('zIndex / base alpha strictly decrease across tiers', () => {
  const tiers: LensTier[] = ['core', 'elevated', 'ambient', 'background'];
  const z = tiers.map((t) => markerStyleForLens(view(t, 0.5)).zIndex);
  assert.deepEqual(z, [3, 2, 1, 0]);
  const a = tiers.map((t) => markerStyleForLens(view(t, 0.5)).alpha);
  for (let i = 1; i < a.length; i++) assert.ok(a[i]! < a[i - 1]!, `${tiers[i]} alpha < ${tiers[i - 1]}`);
});

test('base scale strictly decreases across tiers (at equal relevance)', () => {
  const tiers: LensTier[] = ['core', 'elevated', 'ambient', 'background'];
  const sc = tiers.map((t) => markerStyleForLens(view(t, 0)).scale);
  for (let i = 1; i < sc.length; i++) assert.ok(sc[i]! < sc[i - 1]!);
});

test('relevance adds a continuous size nudge within a tier (0.95 > 0.72 core)', () => {
  const hot = markerStyleForLens(view('core', 0.95));
  const warm = markerStyleForLens(view('core', 0.72));
  assert.ok(hot.scale > warm.scale);
  assert.ok(hot.alpha >= warm.alpha);
});

test('relevance=0 gives the tier base scale exactly (no nudge)', () => {
  const s = markerStyleForLens(view('core', 0));
  assert.equal(s.scale, 1.4);
});

test('relevance=1 gives +15% size over the tier base (within rounding)', () => {
  const s = markerStyleForLens(view('elevated', 1));
  // base 1.15 × (1 + 0.15) = 1.3225, rounded to 3 decimals.
  assert.ok(Math.abs(s.scale - 1.3225) < 0.001);
});

test('within-tier scale ordering matches relevance ordering (monotonic)', () => {
  const rels = [0, 0.25, 0.5, 0.75, 1];
  const scales = rels.map((r) => markerStyleForLens(view('elevated', r)).scale);
  for (let i = 1; i < scales.length; i++) assert.ok(scales[i]! >= scales[i - 1]!);
});

test('non-finite / out-of-range relevance is clamped (no NaN styles)', () => {
  const nan = markerStyleForLens(view('core', Number.NaN));
  assert.ok(Number.isFinite(nan.scale) && Number.isFinite(nan.alpha));
  const over = markerStyleForLens(view('core', 5));
  const at1 = markerStyleForLens(view('core', 1));
  assert.equal(over.scale, at1.scale); // clamped to 1
  const under = markerStyleForLens(view('core', -3));
  const at0 = markerStyleForLens(view('core', 0));
  assert.equal(under.scale, at0.scale);
});

test('alpha never exceeds 1 even at max relevance on an opaque tier', () => {
  const s = markerStyleForLens(view('core', 1));
  assert.ok(s.alpha <= 1);
});

test('relevance 0 gives exactly the tier base alpha (no dimming below base)', () => {
  for (const t of ['core', 'elevated', 'ambient', 'background'] as LensTier[]) {
    const base = round3(lensTint(t).opacity);
    assert.equal(markerStyleForLens(view(t, 0)).alpha, base, `${t} r=0 alpha === base`);
  }
});

test('relevance boosts alpha above the tier base (up to +10%, clamped)', () => {
  // elevated base 0.85 → r=1 gives 0.85*1.1 = 0.935.
  assert.ok(Math.abs(markerStyleForLens(view('elevated', 1)).alpha - 0.935) < 0.001);
  assert.ok(markerStyleForLens(view('elevated', 1)).alpha > markerStyleForLens(view('elevated', 0)).alpha);
});

function round3(n: number): number { return Math.round(n * 1000) / 1000; }

test('markerStyleForTier matches a mid-relevance view of that tier', () => {
  const t = markerStyleForTier('elevated');
  assert.equal(t.outline, true);
  assert.equal(t.zIndex, 2);
  // Deterministic and finite.
  assert.ok(Number.isFinite(t.scale) && t.scale > 0);
});

test('buildLensStyleIndex maps eventId → style; skips empty ids', () => {
  const index = buildLensStyleIndex([
    view('core', 0.9) as LensView & { eventId: string }, // eventId 'e'
    { ...view('background', 0.1), eventId: 'b' },
    { ...view('elevated', 0.5), eventId: '' }, // empty id skipped
  ]);
  assert.equal(index.size, 2);
  assert.ok(index.get('e')!.zIndex === 3);
  assert.ok(index.get('b')!.dimmed === true);
  assert.equal(index.get(''), undefined);
});

test('buildLensStyleIndex is empty for no views (renderer keeps base styles)', () => {
  assert.equal(buildLensStyleIndex([]).size, 0);
});

test('styles are rounded to 3 decimals (stable across renders)', () => {
  const s = markerStyleForLens(view('elevated', 0.333));
  assert.equal(s.scale, Math.round(s.scale * 1000) / 1000);
  assert.equal(s.alpha, Math.round(s.alpha * 1000) / 1000);
});
