import assert from 'node:assert/strict';
import test from 'node:test';

import {
  outageRectExtent,
  radnetPulsePixelSize,
  warZoneColors,
} from '../overlay-helpers.ts';

// ── warZoneColors ────────────────────────────────────────────────────

test('warZoneColors: each threat category maps to a distinct outline', () => {
  const categories = ['state_conflict', 'missile_drone', 'piracy', 'mixed'] as const;
  const seen = new Set<string>();
  for (const cat of categories) {
    const c = warZoneColors(cat);
    assert.match(c.outlineHex, /^#[0-9a-f]{6}$/i, `${cat} outline must be a hex`);
    assert.ok(c.fillAlpha > 0 && c.fillAlpha < 1, `${cat} alpha in (0,1)`);
    seen.add(c.outlineHex);
  }
  assert.equal(seen.size, categories.length, 'each category must map to its own outline color');
});

// ── outageRectExtent ─────────────────────────────────────────────────

test('outageRectExtent: extreme severity is wider than elevated', () => {
  const elev = outageRectExtent(40, -100, 'elevated');
  const ext  = outageRectExtent(40, -100, 'extreme');
  const elevW = elev.east - elev.west;
  const extW  = ext.east  - ext.west;
  assert.ok(extW > elevW, `extreme width ${extW} must exceed elevated width ${elevW}`);
});

test('outageRectExtent: rectangle is centered on the centroid', () => {
  const r = outageRectExtent(40, -100, 'major');
  assert.equal((r.east + r.west) / 2, -100);
  assert.equal((r.north + r.south) / 2, 40);
});

test('outageRectExtent: normal severity collapses to a zero-extent rect', () => {
  const r = outageRectExtent(40, -100, 'normal');
  assert.equal(r.east - r.west, 0);
  assert.equal(r.north - r.south, 0);
});

// ── radnetPulsePixelSize ─────────────────────────────────────────────

test('radnetPulsePixelSize: phase 0 returns minPx', () => {
  assert.equal(radnetPulsePixelSize(0, 1000, 8, 22), 8);
});

test('radnetPulsePixelSize: phase 0.5 returns maxPx', () => {
  assert.equal(radnetPulsePixelSize(500, 1000, 8, 22), 22);
});

test('radnetPulsePixelSize: phase 0.25 is halfway up', () => {
  assert.equal(radnetPulsePixelSize(250, 1000, 8, 22), 15);
});

test('radnetPulsePixelSize: zero period returns midpoint without dividing by zero', () => {
  const r = radnetPulsePixelSize(123, 0, 8, 22);
  assert.ok(Number.isFinite(r));
  assert.equal(r, 15);
});
