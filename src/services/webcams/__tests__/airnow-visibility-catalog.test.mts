import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  annotateVisibility,
  isVisibilityCam,
  visibilityParkCodeOf,
  NPS_VISIBILITY_PARKCODES,
  AIRNOW_VISIBILITY_PROGRAMS,
} from '../airnow-visibility-catalog.ts';
import {
  evaluateSmokeTrigger,
  SMOKE_VISIBILITY_RADIUS_KM,
} from '../webcam-event-triggers.ts';
import type { WebcamFeed } from '../webcam-types';

function feed(over: Partial<WebcamFeed> = {}): WebcamFeed {
  return {
    id: 'NPS:1',
    source: 'NPS',
    name: 'Yosemite Turtleback Dome',
    lat: 37.72,
    lon: -119.7,
    snapshotUrl: 'https://example.gov/yose.jpg',
    refreshIntervalSec: 300,
    category: 'nature',
    metadata: { parkCode: 'yose' },
    isOnline: true,
    ...over,
  };
}

// ── annotateVisibility ────────────────────────────────────────────────────

test('annotateVisibility: tags an NPS cam whose park is on the visibility list', () => {
  const [out] = annotateVisibility([feed({ metadata: { parkCode: 'yose' } })]);
  assert.equal(out!.metadata.visibility, 'true');
  assert.equal(out!.metadata.program, 'airnow');
  assert.equal(isVisibilityCam(out!), true);
});

test('annotateVisibility: leaves a non-visibility NPS cam untouched (same reference)', () => {
  const input = feed({ metadata: { parkCode: 'zion' } });
  const [out] = annotateVisibility([input]);
  assert.equal(out, input); // identity preserved — no needless copy
  assert.equal(isVisibilityCam(out!), false);
});

test('annotateVisibility: matches park code case-insensitively', () => {
  const [out] = annotateVisibility([feed({ metadata: { parkCode: 'YOSE' } })]);
  assert.equal(out!.metadata.visibility, 'true');
});

test('annotateVisibility: ignores non-NPS feeds even at a visibility location', () => {
  const input = feed({ source: 'ALERTWILDFIRE', metadata: { parkCode: 'yose' } });
  const [out] = annotateVisibility([input]);
  assert.equal(out, input);
  assert.equal(isVisibilityCam(out!), false);
});

test('annotateVisibility: preserves existing metadata keys when tagging', () => {
  const [out] = annotateVisibility([feed({ metadata: { parkCode: 'grca', park: 'Grand Canyon' } })]);
  assert.equal(out!.metadata.park, 'Grand Canyon');
  assert.equal(out!.metadata.visibility, 'true');
});

test('annotateVisibility: idempotent — re-tagging returns the same reference', () => {
  const once = annotateVisibility([feed({ metadata: { parkCode: 'acad' } })]);
  const twice = annotateVisibility(once);
  assert.equal(twice[0], once[0]);
});

test('visibilityParkCodeOf: returns null for non-NPS or code-less feeds', () => {
  assert.equal(visibilityParkCodeOf(feed({ source: 'FAA', metadata: {} })), null);
  assert.equal(visibilityParkCodeOf(feed({ metadata: {} })), null);
  assert.equal(visibilityParkCodeOf(feed({ metadata: { parkCode: 'yose' } })), 'yose');
});

test('catalog integrity: 16 canonical NPS park codes + 4 non-NPS programs, all https + finite coords', () => {
  assert.equal(NPS_VISIBILITY_PARKCODES.size, 16);
  assert.equal(AIRNOW_VISIBILITY_PROGRAMS.length, 4);
  for (const p of AIRNOW_VISIBILITY_PROGRAMS) {
    assert.ok(Number.isFinite(p.lat) && Number.isFinite(p.lon), `${p.id} coords`);
    // https-only so the panel's fail-closed safe-open path can actually open them
    assert.match(p.pageUrl, /^https:\/\//, `${p.id} must be https`);
  }
});

// ── evaluateSmokeTrigger ──────────────────────────────────────────────────

const NOW = Date.UTC(2026, 6, 19, 18, 0, 0);
const visYose = annotateVisibility([feed({ id: 'NPS:yose', metadata: { parkCode: 'yose' }, lat: 37.72, lon: -119.7 })]);

test('evaluateSmokeTrigger: Unhealthy AQI near a visibility cam fires', () => {
  const ev = evaluateSmokeTrigger({ id: 'aq1', lat: 37.8, lon: -119.6, aqi: 165, observedAt: NOW }, visYose, NOW, []);
  assert.ok(ev);
  assert.equal(ev!.kind, 'smoke');
  assert.deepEqual(ev!.affectedCamIds, ['NPS:yose']);
  assert.equal(ev!.metadata.aqi, 165);
});

test('evaluateSmokeTrigger: Moderate AQI (<101) does not fire', () => {
  const ev = evaluateSmokeTrigger({ id: 'aq2', lat: 37.8, lon: -119.6, aqi: 80, observedAt: NOW }, visYose, NOW, []);
  assert.equal(ev, null);
});

test('evaluateSmokeTrigger: a raw smoke plume (no AQI) near a cam fires', () => {
  const ev = evaluateSmokeTrigger({ id: 'fire1', lat: 37.9, lon: -119.5, observedAt: NOW }, visYose, NOW, []);
  assert.ok(ev);
  assert.equal(ev!.affectedCamIds.length, 1);
});

test('evaluateSmokeTrigger: no visibility cam within range → null', () => {
  const ev = evaluateSmokeTrigger({ id: 'aq3', lat: 25.0, lon: -80.0, aqi: 200, observedAt: NOW }, visYose, NOW, []);
  assert.equal(ev, null);
});

test('evaluateSmokeTrigger: untagged NPS cams are ignored (must be visibility-tagged)', () => {
  const untagged = [feed({ id: 'NPS:zion', metadata: { parkCode: 'zion' }, lat: 37.72, lon: -119.7 })];
  const ev = evaluateSmokeTrigger({ id: 'aq4', lat: 37.8, lon: -119.6, aqi: 165, observedAt: NOW }, untagged, NOW, []);
  assert.equal(ev, null);
});

test('evaluateSmokeTrigger: a non-NPS partner program in range fires with programIds', () => {
  // Idaho DEQ Dietrich Butte ~ 43.606,-114.36
  const ev = evaluateSmokeTrigger({ id: 'aq5', lat: 43.6, lon: -114.4, aqi: 155, observedAt: NOW }, []);
  assert.ok(ev);
  assert.equal(ev!.affectedCamIds.length, 0);
  assert.match(String(ev!.metadata.programIds), /idaho-dietrich-butte/);
  assert.equal(ev!.metadata.programCount, 1);
});

test('evaluateSmokeTrigger: radius boundary — just outside the range does not fire', () => {
  // ~2 degrees north of Yosemite ≈ 222km > 150km
  const ev = evaluateSmokeTrigger({ id: 'aq6', lat: 39.72, lon: -119.7, aqi: 200, observedAt: NOW }, visYose, NOW, []);
  assert.equal(ev, null);
  assert.ok(SMOKE_VISIBILITY_RADIUS_KM < 222);
});
