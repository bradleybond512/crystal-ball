import assert from 'node:assert/strict';
import { test } from 'node:test';

import { applyLensStyle } from '../lens-marker-apply.ts';
import { markerStyleForLens } from '../lens-marker-style.ts';
import type { LensView } from '../personal-lens.ts';

function view(over: Partial<LensView> = {}): LensView {
  return { eventId: 'e1', relevance: 0.9, tier: 'core', axis: 'physical_safety', drivers: [], ...over };
}

test('applyLensStyle: a core marker gets brighter, bigger, outlined, labeled, on top', () => {
  const style = markerStyleForLens(view({ tier: 'core', relevance: 0.9 }));
  const out = applyLensStyle({ alpha: 0.8, sizePx: 10 }, style);
  assert.ok(out.alpha > 0.8 * 0.9, 'alpha near base×tier'); // sanity: scaled toward base
  assert.ok(out.sizePx > 10, 'core enlarges the marker');
  assert.equal(out.outline, true);
  assert.equal(out.showLabel, true);
  assert.ok(out.zIndex >= 3);
  assert.equal(out.dimmed, false);
});

test('applyLensStyle: a background marker fades, shrinks, drops its label, sinks', () => {
  const style = markerStyleForLens(view({ tier: 'background', relevance: 0.05 }));
  const out = applyLensStyle({ alpha: 1, sizePx: 10 }, style);
  assert.ok(out.alpha < 0.5, 'background fades out');
  assert.ok(out.sizePx < 10, 'background shrinks');
  assert.equal(out.showLabel, false);
  assert.equal(out.outline, false);
  assert.equal(out.dimmed, true);
  assert.equal(out.zIndex, 0);
});

test('applyLensStyle: alpha never exceeds 1 even when base is already full', () => {
  const style = markerStyleForLens(view({ tier: 'core', relevance: 1 }));
  const out = applyLensStyle({ alpha: 1, sizePx: 8 }, style);
  assert.ok(out.alpha <= 1);
});

test('applyLensStyle: size is floored at 1px so a dimmed marker never vanishes', () => {
  const style = markerStyleForLens(view({ tier: 'background', relevance: 0 }));
  const out = applyLensStyle({ alpha: 1, sizePx: 0.5 }, style);
  assert.ok(out.sizePx >= 1);
});

test('applyLensStyle: non-finite base alpha clamps to 0 rather than NaN', () => {
  const style = markerStyleForLens(view());
  const out = applyLensStyle({ alpha: Number.NaN, sizePx: 10 }, style);
  assert.equal(out.alpha, 0);
});

test('applyLensStyle: within a tier, higher relevance reads hotter (bigger + brighter)', () => {
  const hot = applyLensStyle({ alpha: 0.7, sizePx: 10 }, markerStyleForLens(view({ tier: 'core', relevance: 0.95 })));
  const cool = applyLensStyle({ alpha: 0.7, sizePx: 10 }, markerStyleForLens(view({ tier: 'core', relevance: 0.72 })));
  assert.ok(hot.sizePx > cool.sizePx);
  assert.ok(hot.alpha >= cool.alpha);
});
