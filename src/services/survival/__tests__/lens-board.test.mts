import { test } from 'node:test';
import assert from 'node:assert/strict';
import { styleIndexForBoard, applyLensToMarker } from '../lens-board.ts';
import { boardEntityId, toBoardIncomingEvent } from '../board-events.ts';
import type { SurvivalAxis, SurvivalPosture, AxisState } from '../survival-types.ts';
import type { PersonalProfile } from '../../personal/personal-impact.ts';

const NOW = 1_700_000_000_000;
const EMPTY_PROFILE: PersonalProfile = {
  savedPlaces: [], watchedEntities: [], portfolio: [], travelRoutes: [], utilities: [],
};

function posture(levels: Partial<Record<SurvivalAxis, number>>): SurvivalPosture {
  const axes = Object.entries(levels).map(([axis, level]) => ({ axis, level } as AxisState));
  return { axes, overallLevel: 0, overallBand: 'secure', worstAxis: 'physical_safety', headline: '', capturedAtMs: NOW, staleInputs: [] } as SurvivalPosture;
}

// ── styleIndexForBoard ────────────────────────────────────────────────────────

test('styleIndexForBoard keys styles by the board eventId (matches the marker id)', () => {
  const ev = toBoardIncomingEvent('earthquake', { rawId: 'us7000abcd', severity: 90, at: NOW });
  const index = styleIndexForBoard([ev], EMPTY_PROFILE, posture({ physical_safety: 90 }),
    { now: () => NOW });
  const id = boardEntityId('earthquake', 'us7000abcd');
  assert.ok(index.has(id), 'index keyed by boardEntityId');
  assert.equal(ev.eventId, id); // the marker will carry this exact id
});

test('styleIndexForBoard: a hot-axis high-severity event lands in a bright tier', () => {
  const ev = toBoardIncomingEvent('conflict', { rawId: 1, severity: 95, at: NOW });
  const index = styleIndexForBoard([ev], EMPTY_PROFILE, posture({ security: 95 }), { now: () => NOW });
  const style = index.get(ev.eventId)!;
  assert.ok(style.zIndex >= 2, 'core/elevated tier is on top');
  assert.ok(style.alpha > 0.8);
  assert.equal(style.outline, true);
});

test('styleIndexForBoard: empty events → empty index', () => {
  assert.equal(styleIndexForBoard([], EMPTY_PROFILE, posture({}), { now: () => NOW }).size, 0);
});

test('styleIndexForBoard: an irrelevant background event is dimmed (low z, faded)', () => {
  const ev = toBoardIncomingEvent('earthquake', { rawId: 'q', severity: 5, at: NOW });
  const index = styleIndexForBoard([ev], EMPTY_PROFILE, posture({}), { now: () => NOW });
  const style = index.get(ev.eventId)!;
  assert.equal(style.dimmed, true);
  assert.equal(style.zIndex, 0);
});

// ── applyLensToMarker ─────────────────────────────────────────────────────────

test('applyLensToMarker multiplies alpha (clamped) and size', () => {
  const out = applyLensToMarker({ alpha: 0.8, scale: 10 }, { alpha: 1, scale: 1.4, outline: true, showLabel: true, zIndex: 3, dimmed: false });
  assert.ok(Math.abs(out.alpha - 0.8) < 1e-9);
  assert.ok(Math.abs(out.scale - 14) < 1e-9);
});

test('applyLensToMarker clamps alpha to [0,1] and never yields negative size', () => {
  const hi = applyLensToMarker({ alpha: 0.9, scale: 4 }, { alpha: 2, scale: 1, outline: false, showLabel: false, zIndex: 1, dimmed: false });
  assert.equal(hi.alpha, 1); // 0.9*2 clamped
  const zero = applyLensToMarker({ alpha: 1, scale: 0 }, { alpha: 0, scale: 0, outline: false, showLabel: false, zIndex: 0, dimmed: true });
  assert.equal(zero.alpha, 0);
  assert.equal(zero.scale, 0);
});

test('applyLensToMarker: a dimming style fades and shrinks the marker', () => {
  const base = { alpha: 1, scale: 10 };
  const dim = applyLensToMarker(base, { alpha: 0.25, scale: 0.7, outline: false, showLabel: false, zIndex: 0, dimmed: true });
  assert.ok(dim.alpha < base.alpha);
  assert.ok(dim.scale < base.scale);
});

test('applyLensToMarker: non-finite base alpha does not produce NaN', () => {
  const out = applyLensToMarker({ alpha: Number.NaN, scale: 5 }, { alpha: 1, scale: 1, outline: false, showLabel: false, zIndex: 0, dimmed: false });
  assert.equal(out.alpha, 0);
  assert.ok(Number.isFinite(out.scale));
});

test('applyLensToMarker: non-finite scale (base or style) collapses to 0, never NaN/Infinity', () => {
  const style = { alpha: 1, scale: 1, outline: false, showLabel: false, zIndex: 0, dimmed: false };
  const nanBase = applyLensToMarker({ alpha: 1, scale: Number.NaN }, style);
  assert.equal(nanBase.scale, 0);
  const infBase = applyLensToMarker({ alpha: 1, scale: Number.POSITIVE_INFINITY }, style);
  assert.equal(infBase.scale, 0);
  const nanStyle = applyLensToMarker({ alpha: 1, scale: 5 }, { ...style, scale: Number.NaN });
  assert.equal(nanStyle.scale, 0);
  const infStyle = applyLensToMarker({ alpha: 1, scale: 5 }, { ...style, scale: Number.POSITIVE_INFINITY });
  assert.equal(infStyle.scale, 0);
});

test('end-to-end: a core (personally-exposed, hot-axis) marker keeps alpha + grows', () => {
  // Event AT the user's home → personal exposure → core tier (opacity multiplier 1).
  const home: PersonalProfile = {
    ...EMPTY_PROFILE,
    savedPlaces: [{ placeId: 'home', label: 'Home', latitude: 41.6, longitude: -86.7, role: 'home' }],
  };
  const ev = toBoardIncomingEvent('earthquake', {
    rawId: 'q1', severity: 95, at: NOW,
    location: { latitude: 41.6, longitude: -86.7, radiusKm: 25 },
  });
  const index = styleIndexForBoard([ev], home, posture({ physical_safety: 95 }), { now: () => NOW });
  const style = index.get(boardEntityId('earthquake', 'q1'))!;
  assert.equal(style.zIndex, 3); // core tier renders on top
  assert.equal(style.alpha, 1);  // core opacity multiplier
  const styled = applyLensToMarker({ alpha: 0.6, scale: 8 }, style);
  // Core opacity multiplier is 1 → base alpha preserved; scale grows.
  assert.ok(styled.alpha >= 0.6 - 1e-9);
  assert.ok(styled.scale > 8);
});

test('a background event dims a full-alpha base marker below it', () => {
  const ev = toBoardIncomingEvent('earthquake', { rawId: 'bg', severity: 3, at: NOW });
  const index = styleIndexForBoard([ev], EMPTY_PROFILE, posture({}), { now: () => NOW });
  const styled = applyLensToMarker({ alpha: 1, scale: 10 }, index.get(ev.eventId)!);
  assert.ok(styled.alpha < 0.5); // faded back
  assert.ok(styled.scale < 10);  // shrunk
});

test('styleIndexForBoard is deterministic for the same inputs', () => {
  const ev = toBoardIncomingEvent('conflict', { rawId: 7, severity: 60, at: NOW });
  const a = styleIndexForBoard([ev], EMPTY_PROFILE, posture({ security: 50 }), { now: () => NOW });
  const b = styleIndexForBoard([ev], EMPTY_PROFILE, posture({ security: 50 }), { now: () => NOW });
  assert.deepEqual(a.get(ev.eventId), b.get(ev.eventId));
});
