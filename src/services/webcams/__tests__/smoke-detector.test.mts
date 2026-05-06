import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SMOKE_DETECT_DOWNSAMPLE_H,
  SMOKE_DETECT_DOWNSAMPLE_W,
  SMOKE_INTERVAL_MS,
  analyzeFrameDelta,
  runSmokeDetection,
  type FrameSample,
  type SmokeAnalysis,
} from '../smoke-detector.ts';

function uniformFrame(w: number, h: number, gray: number): FrameSample {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    px[i * 4] = gray;
    px[i * 4 + 1] = gray;
    px[i * 4 + 2] = gray;
    px[i * 4 + 3] = 255;
  }
  return { width: w, height: h, pixels: px };
}

function frameWithUpperBand(
  w: number,
  h: number,
  baseGray: number,
  bandGray: number,
  bandRows: number,
): FrameSample {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      const v = y < bandRows ? bandGray : baseGray;
      px[idx] = v;
      px[idx + 1] = v;
      px[idx + 2] = v;
      px[idx + 3] = 255;
    }
  }
  return { width: w, height: h, pixels: px };
}

// ── analyzeFrameDelta ───────────────────────────────────────────────────

test('analyzeFrameDelta: identical frames → zero delta, no alert', () => {
  const a = uniformFrame(40, 30, 100);
  const b = uniformFrame(40, 30, 100);
  const r = analyzeFrameDelta(a, b);
  assert.equal(r.meanDelta, 0);
  assert.equal(r.motionPixels, 0);
  assert.equal(r.changedFraction, 0);
  assert.equal(r.isAlert, false);
});

test('analyzeFrameDelta: mismatched dims → empty result', () => {
  const a = uniformFrame(40, 30, 100);
  const b = uniformFrame(20, 30, 100);
  const r = analyzeFrameDelta(a, b);
  assert.equal(r.totalPixels, 0);
  assert.equal(r.isAlert, false);
});

test('analyzeFrameDelta: large upper-third change + many changed pixels → alert', () => {
  // h=30, upper third = rows 0..9 (10 rows of upper band changing dramatically)
  const a = frameWithUpperBand(40, 30, 50, 50, 10); // uniform
  const b = frameWithUpperBand(40, 30, 50, 200, 10); // big change in upper 10 rows
  const r = analyzeFrameDelta(a, b);
  assert.ok(r.upperRegionMeanDelta > 100, `upper delta ${r.upperRegionMeanDelta}`);
  assert.ok(r.changedFraction > 0.08, `frac ${r.changedFraction}`);
  assert.equal(r.isAlert, true);
  assert.ok(r.smokeProbability > 0.5);
});

test('analyzeFrameDelta: lower-third change only → no alert (smoke signature is upper)', () => {
  const a = uniformFrame(40, 30, 50);
  // Change rows 20..29 (lower third) — upper third unchanged
  const px = new Uint8ClampedArray(40 * 30 * 4);
  for (let y = 0; y < 30; y++) {
    for (let x = 0; x < 40; x++) {
      const idx = (y * 40 + x) * 4;
      const v = y >= 20 ? 200 : 50;
      px[idx] = v;
      px[idx + 1] = v;
      px[idx + 2] = v;
      px[idx + 3] = 255;
    }
  }
  const b: FrameSample = { width: 40, height: 30, pixels: px };
  const r = analyzeFrameDelta(a, b);
  assert.ok(r.upperRegionMeanDelta < 5);
  assert.equal(r.isAlert, false);
});

test('analyzeFrameDelta: tiny change in upper region → no alert', () => {
  const a = uniformFrame(40, 30, 50);
  const b = uniformFrame(40, 30, 51); // 1-channel delta everywhere
  const r = analyzeFrameDelta(a, b);
  assert.equal(r.isAlert, false);
  assert.ok(r.smokeProbability < 0.5);
});

test('analyzeFrameDelta: changedFraction is correct', () => {
  // half pixels changed by a lot, half unchanged
  const w = 20;
  const h = 30; // total 600 pixels
  const a = uniformFrame(w, h, 50);
  const px = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      const v = x < w / 2 ? 200 : 50;
      px[idx] = v;
      px[idx + 1] = v;
      px[idx + 2] = v;
      px[idx + 3] = 255;
    }
  }
  const b: FrameSample = { width: w, height: h, pixels: px };
  const r = analyzeFrameDelta(a, b);
  assert.ok(Math.abs(r.changedFraction - 0.5) < 0.01, `got ${r.changedFraction}`);
});

test('analyzeFrameDelta: smokeProbability ranges in [0, 1]', () => {
  const a = uniformFrame(40, 30, 50);
  const b = uniformFrame(40, 30, 250); // huge delta everywhere
  const r = analyzeFrameDelta(a, b);
  assert.ok(r.smokeProbability >= 0 && r.smokeProbability <= 1);
});

// ── runSmokeDetection (mock sampler) ────────────────────────────────────

test('runSmokeDetection: returns analysis when sampler succeeds', async () => {
  const a = frameWithUpperBand(40, 30, 50, 50, 10);
  const b = frameWithUpperBand(40, 30, 50, 200, 10);
  const samples = [a, b];
  const sampler = async (): Promise<FrameSample | null> => samples.shift() ?? null;
  const r = await runSmokeDetection('cam-1', 'http://x/y.jpg', { sampler, intervalMs: 1 });
  assert.equal(r.camId, 'cam-1');
  assert.ok(r.analysis !== null);
  assert.equal(r.analysis.isAlert, true);
});

test('runSmokeDetection: null when first sample fails', async () => {
  const sampler = async (): Promise<FrameSample | null> => null;
  const r = await runSmokeDetection('cam', 'x', { sampler, intervalMs: 1 });
  assert.equal(r.analysis, null);
});

test('runSmokeDetection: null when second sample fails', async () => {
  const a = uniformFrame(40, 30, 50);
  let i = 0;
  const sampler = async (): Promise<FrameSample | null> => {
    i++;
    return i === 1 ? a : null;
  };
  const r = await runSmokeDetection('cam', 'x', { sampler, intervalMs: 1 });
  assert.equal(r.analysis, null);
});

// ── Constants ───────────────────────────────────────────────────────────

test('SMOKE_DETECT_DOWNSAMPLE_W is 160', () => {
  assert.equal(SMOKE_DETECT_DOWNSAMPLE_W, 160);
});

test('SMOKE_DETECT_DOWNSAMPLE_H is 120', () => {
  assert.equal(SMOKE_DETECT_DOWNSAMPLE_H, 120);
});

test('SMOKE_INTERVAL_MS is 5000', () => {
  assert.equal(SMOKE_INTERVAL_MS, 5000);
});

// Suppress unused warning for SmokeAnalysis type re-export check
const _t: SmokeAnalysis = {
  smokeProbability: 0,
  motionPixels: 0,
  totalPixels: 0,
  changedFraction: 0,
  meanDelta: 0,
  upperRegionMeanDelta: 0,
  isAlert: false,
};
test('SmokeAnalysis type sanity', () => assert.equal(_t.isAlert, false));
